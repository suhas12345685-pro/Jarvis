import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AgentContext, AppConfig } from '../../src/types/index.js'

const mockCreate = vi.fn()

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  })),
}))

vi.mock('../../src/skills/index.js', () => ({
  toLLMTools: () => [],
  getAllDefinitions: () => [],
  registerSkill: vi.fn(),
  getSkill: vi.fn().mockReturnValue({
    name: 'test_tool',
    handler: vi.fn().mockResolvedValue({ output: 'tool result', isError: false }),
  }),
}))

const makeCtx = (): AgentContext & { interim: string[]; final: string[] } => {
  const interim: string[] = []
  const final: string[] = []
  return {
    channelType: 'api',
    userId: 'user1',
    threadId: 'thread1',
    rawMessage: 'Hello JARVIS',
    memories: [],
    systemPrompt: 'You are JARVIS',
    byoak: [],
    interim,
    final,
    sendInterim: async (msg: string) => { interim.push(msg); return 'msg-id' },
    sendFinal: async (msg: string) => { final.push(msg) },
  }
}

const makeConfig = (): AppConfig => ({
  anthropicApiKey: 'sk-ant-test',
  llmProvider: 'anthropic',
  llmModel: 'claude-sonnet-4-6',
  dbMode: 'sqlite',
  sqlitePath: '/tmp/test.db',
  redisUrl: 'redis://localhost:6379',
  port: 3000,
  logPath: '/tmp/test.log',
  byoak: [],
})

describe('toolCaller', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns text response on end_turn', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Hello, how can I help?' }],
      stop_reason: 'end_turn',
    })

    const { runToolLoop } = await import('../../src/toolCaller.js')
    const ctx = makeCtx()
    const result = await runToolLoop(ctx, makeConfig())
    expect(result).toBe('Hello, how can I help?')
  })

  it('handles tool use and returns final text', async () => {
    mockCreate
      .mockResolvedValueOnce({
        content: [{ type: 'tool_use', id: 'tu1', name: 'test_tool', input: {} }],
        stop_reason: 'tool_use',
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Done using tool.' }],
        stop_reason: 'end_turn',
      })

    const { runToolLoop } = await import('../../src/toolCaller.js')
    const ctx = makeCtx()
    const result = await runToolLoop(ctx, makeConfig())
    expect(result).toBe('Done using tool.')
  })

  it('aborts when signal is aborted', async () => {
    const controller = new AbortController()
    controller.abort()

    const { runToolLoop } = await import('../../src/toolCaller.js')
    const ctx = makeCtx()
    await expect(runToolLoop(ctx, makeConfig(), controller.signal)).rejects.toThrow('Aborted')
  })

  it('returns fallback text on empty response', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [],
      stop_reason: 'end_turn',
    })

    const { runToolLoop } = await import('../../src/toolCaller.js')
    const ctx = makeCtx()
    const result = await runToolLoop(ctx, makeConfig())
    expect(result).toBe('Done.')
  })
})
