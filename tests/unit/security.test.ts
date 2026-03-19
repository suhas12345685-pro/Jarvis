import { describe, it, expect, afterEach } from 'vitest'
import { validateUrl, validateHeaders, IPRateLimiter } from '../../src/security.js'

describe('validateUrl', () => {
  it('allows valid external URLs', () => {
    expect(validateUrl('https://api.example.com/v1/data')).toEqual({ valid: true })
    expect(validateUrl('http://example.com')).toEqual({ valid: true })
    expect(validateUrl('https://api.stripe.com/v1/charges')).toEqual({ valid: true })
  })

  it('blocks localhost', () => {
    const result = validateUrl('http://localhost:3000/admin')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('localhost')
  })

  it('blocks 127.0.0.1', () => {
    const result = validateUrl('http://127.0.0.1:8080')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('private IP')
  })

  it('blocks 10.x private IPs', () => {
    expect(validateUrl('http://10.0.0.1/internal').valid).toBe(false)
  })

  it('blocks 192.168.x private IPs', () => {
    expect(validateUrl('http://192.168.1.1/router').valid).toBe(false)
  })

  it('blocks 172.16-31 private IPs', () => {
    expect(validateUrl('http://172.16.0.1/internal').valid).toBe(false)
    expect(validateUrl('http://172.31.255.255').valid).toBe(false)
  })

  it('blocks AWS metadata endpoint', () => {
    const result = validateUrl('http://169.254.169.254/latest/meta-data/')
    expect(result.valid).toBe(false)
  })

  it('blocks GCP metadata endpoint', () => {
    const result = validateUrl('http://metadata.google.internal/computeMetadata/v1/')
    expect(result.valid).toBe(false)
  })

  it('blocks non-HTTP protocols', () => {
    expect(validateUrl('ftp://example.com/file').valid).toBe(false)
    expect(validateUrl('file:///etc/passwd').valid).toBe(false)
    expect(validateUrl('gopher://example.com').valid).toBe(false)
  })

  it('blocks URLs with embedded credentials', () => {
    const result = validateUrl('http://admin:password@example.com')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('credentials')
  })

  it('rejects invalid URL format', () => {
    expect(validateUrl('not-a-url').valid).toBe(false)
    expect(validateUrl('').valid).toBe(false)
  })
})

describe('validateHeaders', () => {
  it('allows normal headers', () => {
    expect(validateHeaders({ 'Content-Type': 'application/json' })).toEqual({ valid: true })
    expect(validateHeaders({ 'Authorization': 'Bearer token123' })).toEqual({ valid: true })
  })

  it('blocks CRLF injection in header values', () => {
    const result = validateHeaders({ 'X-Custom': 'value\r\nInjected: header' })
    expect(result.valid).toBe(false)
    expect(result.error).toContain('injection')
  })

  it('blocks CRLF injection in header keys', () => {
    const result = validateHeaders({ 'X-Custom\r\nInjected': 'value' })
    expect(result.valid).toBe(false)
  })
})

describe('IPRateLimiter', () => {
  let limiter: IPRateLimiter

  afterEach(() => {
    limiter?.destroy()
  })

  it('allows requests within limit', () => {
    limiter = new IPRateLimiter(60_000, 5)
    for (let i = 0; i < 5; i++) {
      expect(limiter.isAllowed('1.2.3.4')).toBe(true)
    }
  })

  it('blocks requests exceeding limit', () => {
    limiter = new IPRateLimiter(60_000, 3)
    expect(limiter.isAllowed('1.2.3.4')).toBe(true)
    expect(limiter.isAllowed('1.2.3.4')).toBe(true)
    expect(limiter.isAllowed('1.2.3.4')).toBe(true)
    expect(limiter.isAllowed('1.2.3.4')).toBe(false)
  })

  it('tracks IPs independently', () => {
    limiter = new IPRateLimiter(60_000, 2)
    expect(limiter.isAllowed('1.1.1.1')).toBe(true)
    expect(limiter.isAllowed('1.1.1.1')).toBe(true)
    expect(limiter.isAllowed('1.1.1.1')).toBe(false)
    expect(limiter.isAllowed('2.2.2.2')).toBe(true) // different IP
  })
})
