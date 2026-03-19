import { describe, it, expect, beforeAll } from 'vitest'
import type { AgentContext } from '../../../src/types/index.js'

// Load the skill (self-registers)
beforeAll(async () => {
  await import('../../../src/skills/osTerminal.js')
})

const mockCtx: AgentContext = {
  channelType: 'api',
  userId: 'test',
  threadId: 'test',
  rawMessage: 'test',
  memories: [],
  systemPrompt: '',
  byoak: [],
  sendInterim: async () => undefined,
  sendFinal: async () => {},
}

describe('osTerminal skill', async () => {
  const { getSkill } = await import('../../../src/skills/index.js')

  it('runs a safe command and returns stdout', async () => {
    const skill = getSkill('os_terminal')
    const result = await skill!.handler({ command: 'echo hello' }, mockCtx)
    expect(result.isError).toBe(false)
    expect(result.output).toContain('hello')
  })

  it('blocks rm -rf commands', async () => {
    const skill = getSkill('os_terminal')
    const result = await skill!.handler({ command: 'rm -rf /tmp/test' }, mockCtx)
    expect(result.isError).toBe(true)
    expect(result.output).toContain('BLOCKED')
  })

  it('blocks shutdown command', async () => {
    const skill = getSkill('os_terminal')
    const result = await skill!.handler({ command: 'shutdown now' }, mockCtx)
    expect(result.isError).toBe(true)
    expect(result.output).toContain('BLOCKED')
  })

  it('blocks mkfs command', async () => {
    const skill = getSkill('os_terminal')
    const result = await skill!.handler({ command: 'mkfs.ext4 /dev/sda' }, mockCtx)
    expect(result.isError).toBe(true)
    expect(result.output).toContain('BLOCKED')
  })

  it('blocks fork bomb', async () => {
    const skill = getSkill('os_terminal')
    const result = await skill!.handler({ command: ':(){ :|:& };:' }, mockCtx)
    expect(result.isError).toBe(true)
    expect(result.output).toContain('BLOCKED')
  })

  it('returns stderr on failing command', async () => {
    const skill = getSkill('os_terminal')
    const result = await skill!.handler({ command: 'ls /this/path/does/not/exist/xyz' }, mockCtx)
    expect(result.isError).toBe(true)
  })

  it('rejects empty command', async () => {
    const skill = getSkill('os_terminal')
    const result = await skill!.handler({ command: '' }, mockCtx)
    expect(result.isError).toBe(true)
  })
})
