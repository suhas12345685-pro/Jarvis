import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, unlinkSync, readFileSync, mkdirSync } from 'fs'
import { resolve } from 'path'
import { tmpdir } from 'os'

// We test the formatting and read functions by importing the module.
// The ghost log writes to ~/.jarvis/ghost.log by default, but we can
// test the logic by examining outputs.

describe('ghostLog', () => {
  // Use a temp dir approach: the module writes to ~/.jarvis/ghost.log,
  // so we test the exported functions directly.

  let ghostInfo: typeof import('../../../src/cli/ghostLog.js').ghostInfo
  let ghostError: typeof import('../../../src/cli/ghostLog.js').ghostError
  let ghostResult: typeof import('../../../src/cli/ghostLog.js').ghostResult
  let readRecent: typeof import('../../../src/cli/ghostLog.js').readRecent
  let readRecentResults: typeof import('../../../src/cli/ghostLog.js').readRecentResults
  let GHOST_LOG_PATH: string

  beforeEach(async () => {
    const mod = await import('../../../src/cli/ghostLog.js')
    ghostInfo = mod.ghostInfo
    ghostError = mod.ghostError
    ghostResult = mod.ghostResult
    readRecent = mod.readRecent
    readRecentResults = mod.readRecentResults
    GHOST_LOG_PATH = mod.GHOST_LOG_PATH
  })

  it('ghostInfo writes an INFO entry to the log', () => {
    ghostInfo('test message', { key: 'value' })
    const content = readFileSync(GHOST_LOG_PATH, 'utf-8')
    expect(content).toContain('[INFO]')
    expect(content).toContain('test message')
    expect(content).toContain('"key":"value"')
  })

  it('ghostError writes an ERROR entry to the log', () => {
    ghostError('error message')
    const content = readFileSync(GHOST_LOG_PATH, 'utf-8')
    expect(content).toContain('[ERROR]')
    expect(content).toContain('error message')
  })

  it('ghostResult writes a RESULT block with separators', () => {
    ghostResult('task-123', 'This is the result output')
    const content = readFileSync(GHOST_LOG_PATH, 'utf-8')
    expect(content).toContain('[RESULT]')
    expect(content).toContain('task-123')
    expect(content).toContain('This is the result output')
    expect(content).toContain('═')
  })

  it('readRecent returns recent log lines', () => {
    ghostInfo('line-for-recent')
    const recent = readRecent(100)
    expect(recent).toContain('line-for-recent')
  })

  it('readRecentResults filters for RESULT entries only', () => {
    ghostInfo('not a result')
    ghostResult('test-task', 'the actual result')
    const results = readRecentResults(5)
    expect(results).toContain('[RESULT]')
    expect(results).toContain('the actual result')
  })
})
