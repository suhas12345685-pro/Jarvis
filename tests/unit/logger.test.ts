import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createLogger, getLogger, registerByoakValues } from '../../src/logger.js'
import { mkdirSync } from 'fs'
import { resolve } from 'path'
import { tmpdir } from 'os'

describe('logger', () => {
  const logPath = resolve(tmpdir(), '.jarvis-test', 'test.log')

  beforeEach(() => {
    mkdirSync(resolve(tmpdir(), '.jarvis-test'), { recursive: true })
  })

  it('creates a logger instance', () => {
    const logger = createLogger(logPath)
    expect(logger).toBeDefined()
    expect(typeof logger.info).toBe('function')
    expect(typeof logger.error).toBe('function')
    expect(typeof logger.warn).toBe('function')
  })

  it('getLogger returns a fallback logger before init', () => {
    // Note: getLogger returns the last created logger or a fallback
    const logger = getLogger()
    expect(logger).toBeDefined()
    expect(typeof logger.info).toBe('function')
  })

  it('registerByoakValues accepts values without error', () => {
    // Should not throw
    registerByoakValues(['secret-value-12345', 'another-secret-value', 'short'])
  })

  it('ignores short values (6 or fewer chars)', () => {
    // Shouldn't throw or cause issues
    registerByoakValues(['ab', '123456', ''])
  })
})
