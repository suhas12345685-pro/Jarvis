import winston from 'winston'
import { mkdirSync } from 'fs'
import { dirname } from 'path'

// Keys to redact — populated at startup via registerByoakValues()
const SENSITIVE_VALUES = new Set<string>()

// Regex patterns for common PII
const PII_PATTERNS = [
  /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g,          // credit card
  /\b\d{3}-?\d{2}-?\d{4}\b/g,                            // SSN
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,   // email
  /sk-ant-[A-Za-z0-9\-_]{10,}/g,                         // Anthropic keys
  /sk_live_[A-Za-z0-9]{10,}/g,                           // Stripe live keys
  /sk_test_[A-Za-z0-9]{10,}/g,                           // Stripe test keys
  /xoxb-[A-Za-z0-9\-]{10,}/g,                            // Slack bot tokens
  /xapp-[A-Za-z0-9\-]{10,}/g,                            // Slack app tokens
]

function scrub(value: string): string {
  let result = value

  // Redact registered BYOAK values
  for (const secret of SENSITIVE_VALUES) {
    if (secret.length > 6) {
      result = result.split(secret).join('[REDACTED]')
    }
  }

  // Redact PII patterns
  for (const pattern of PII_PATTERNS) {
    result = result.replace(pattern, '[REDACTED]')
  }

  return result
}

function scrubObject(obj: unknown): unknown {
  if (typeof obj === 'string') return scrub(obj)
  if (typeof obj !== 'object' || obj === null) return obj
  if (Array.isArray(obj)) return obj.map(scrubObject)

  const result: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    result[k] = scrubObject(v)
  }
  return result
}

const piiScrubberFormat = winston.format(info => {
  const scrubbed = scrubObject(info) as winston.Logform.TransformableInfo
  return scrubbed
})

export function registerByoakValues(values: string[]): void {
  for (const v of values) {
    if (v && v.length > 6) SENSITIVE_VALUES.add(v)
  }
}

let _logger: winston.Logger | null = null

export function createLogger(logPath: string): winston.Logger {
  mkdirSync(dirname(logPath), { recursive: true })

  const transports: winston.transport[] = [
    new winston.transports.File({
      filename: logPath,
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
      tailable: true,
    }),
  ]

  if (process.env.NODE_ENV !== 'production') {
    transports.push(
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.simple()
        ),
      })
    )
  }

  _logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
      piiScrubberFormat(),
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      winston.format.json()
    ),
    transports,
  })

  return _logger
}

export function getLogger(): winston.Logger {
  if (!_logger) {
    // Fallback console logger before full init
    _logger = winston.createLogger({
      level: 'info',
      format: winston.format.simple(),
      transports: [new winston.transports.Console()],
    })
  }
  return _logger
}
