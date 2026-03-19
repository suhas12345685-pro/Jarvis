import { URL } from 'url'
import { getLogger } from './logger.js'

// ── SSRF Protection ──────────────────────────────────────────────────────────

/** Private/internal IP ranges that should never be accessed by the API fetcher */
const BLOCKED_IP_RANGES = [
  /^127\./,                          // loopback
  /^10\./,                           // class A private
  /^172\.(1[6-9]|2\d|3[01])\./,     // class B private
  /^192\.168\./,                     // class C private
  /^169\.254\./,                     // link-local
  /^0\./,                            // current network
  /^100\.(6[4-9]|[7-9]\d|1[0-2]\d)\./, // shared address space
  /^198\.1[89]\./,                   // benchmark testing
  /^::1$/,                           // IPv6 loopback
  /^fc00:/i,                         // IPv6 unique local
  /^fe80:/i,                         // IPv6 link-local
  /^fd/i,                            // IPv6 private
]

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',        // GCP metadata
  'metadata.google.com',
  '169.254.169.254',                 // AWS/GCP/Azure metadata
  '[::1]',
  'kubernetes.default.svc',
])

/** Blocked URL schemes */
const ALLOWED_SCHEMES = new Set(['http:', 'https:'])

export function validateUrl(rawUrl: string): { valid: boolean; error?: string } {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return { valid: false, error: 'Invalid URL format' }
  }

  // Only allow http/https
  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    return { valid: false, error: `Blocked protocol: ${parsed.protocol}. Only HTTP(S) allowed.` }
  }

  // Block internal hostnames
  const hostname = parsed.hostname.toLowerCase()
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { valid: false, error: `Blocked hostname: ${hostname} (internal/metadata endpoint)` }
  }

  // Block private IP ranges
  for (const pattern of BLOCKED_IP_RANGES) {
    if (pattern.test(hostname)) {
      return { valid: false, error: `Blocked private IP: ${hostname}` }
    }
  }

  // Block URLs with credentials
  if (parsed.username || parsed.password) {
    return { valid: false, error: 'URLs with embedded credentials are not allowed' }
  }

  return { valid: true }
}

// ── IP-based Rate Limiter ────────────────────────────────────────────────────

export class IPRateLimiter {
  private requests = new Map<string, number[]>()
  private readonly windowMs: number
  private readonly maxRequests: number
  private cleanupInterval: ReturnType<typeof setInterval>

  constructor(windowMs = 60_000, maxRequests = 60) {
    this.windowMs = windowMs
    this.maxRequests = maxRequests

    // Periodic cleanup to prevent memory leaks
    this.cleanupInterval = setInterval(() => this.cleanup(), windowMs * 2)
    // Don't prevent process exit
    if (this.cleanupInterval.unref) this.cleanupInterval.unref()
  }

  isAllowed(ip: string): boolean {
    const now = Date.now()
    const timestamps = this.requests.get(ip) ?? []
    const recent = timestamps.filter(t => now - t < this.windowMs)
    if (recent.length >= this.maxRequests) return false
    recent.push(now)
    this.requests.set(ip, recent)
    return true
  }

  private cleanup(): void {
    const now = Date.now()
    for (const [ip, timestamps] of this.requests) {
      const recent = timestamps.filter(t => now - t < this.windowMs)
      if (recent.length === 0) {
        this.requests.delete(ip)
      } else {
        this.requests.set(ip, recent)
      }
    }
  }

  destroy(): void {
    clearInterval(this.cleanupInterval)
    this.requests.clear()
  }
}

// ── Input Sanitization ───────────────────────────────────────────────────────

/** Sanitize strings that might end up in shell commands or SQL */
export function sanitizeInput(input: string, maxLength = 10_000): string {
  if (input.length > maxLength) {
    getLogger().warn('Input truncated', { originalLength: input.length, maxLength })
    return input.slice(0, maxLength)
  }
  return input
}

/** Check for common header injection patterns */
export function validateHeaders(headers: Record<string, string>): { valid: boolean; error?: string } {
  for (const [key, value] of Object.entries(headers)) {
    // Check for CRLF injection
    if (/[\r\n]/.test(key) || /[\r\n]/.test(value)) {
      return { valid: false, error: `Header injection detected in "${key}"` }
    }
  }
  return { valid: true }
}
