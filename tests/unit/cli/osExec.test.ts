import { describe, it, expect } from 'vitest'
import { run } from '../../../src/cli/osExec.js'

describe('osExec (Ghost CLI)', () => {
  it('runs a safe command and returns stdout', async () => {
    const result = await run('echo hello-ghost')
    expect(result.blocked).toBe(false)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('hello-ghost')
  })

  it('blocks rm -rf commands', async () => {
    const result = await run('rm -rf /tmp/danger')
    expect(result.blocked).toBe(true)
    expect(result.stderr).toContain('BLOCKED')
  })

  it('blocks shutdown command', async () => {
    const result = await run('shutdown now')
    expect(result.blocked).toBe(true)
    expect(result.stderr).toContain('BLOCKED')
  })

  it('blocks fork bomb', async () => {
    const result = await run(':(){ :|:& };:')
    expect(result.blocked).toBe(true)
    expect(result.stderr).toContain('BLOCKED')
  })

  it('blocks mkfs command', async () => {
    const result = await run('mkfs.ext4 /dev/sda')
    expect(result.blocked).toBe(true)
  })

  it('blocks dd command', async () => {
    const result = await run('dd if=/dev/zero of=/dev/sda')
    expect(result.blocked).toBe(true)
  })

  it('rejects empty command', async () => {
    const result = await run('')
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('empty command')
  })

  it('returns stderr on failing command', async () => {
    const result = await run('ls /nonexistent/path/abc123')
    expect(result.exitCode).not.toBe(0)
  })

  it('uses custom working directory', async () => {
    const result = await run('pwd', '/tmp')
    expect(result.stdout.trim()).toBe('/tmp')
  })
})
