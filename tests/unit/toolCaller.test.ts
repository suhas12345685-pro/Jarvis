import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AgentContext, AppConfig } from '../../src/types/index.js'

const mockChat = vi.fn()

// Mock LLM registry — toolCaller uses getProvider(), not raw Anthropic SDK
vi.mock('../../src/llm/registry.js', () => ({
  getProvider: () => ({
    name: 'mock',
    chat: mockChat,
  }),
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

// Mock modules imported by toolCaller
vi.mock('../../src/consciousness.js', () => ({
  getConsciousness: () => ({
    think: vi.fn(),
    onSkillUsed: vi.fn(),
  }),
}))

vi.mock('../../src/persona.js', () => ({
  buildPersonaPrompt: () => 'You are JARVIS',
}))

vi.mock('../../src/skills/proactiveCare.js', () => ({
  checkProactiveCare: vi.fn().mockResolvedValue(null),
}))

vi.mock('../../src/learningEngine.js', () => ({
  recallRelevantKnowledge: vi.fn().mockResolvedValue([]),
  learnFromOutcome: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../src/autoSkillGenerator.js', () => ({
  autoGenerateSkill: vi.fn().mockResolvedValue(false),
}))

vi.mock('../../src/config.js', () => ({
  getByoakValue: () => null,
}))

vi.mock('../../src/logger.js', () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
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
    // First call: silentCapabilityCheck
    mockChat.mockResolvedValueOnce({
      text: 'SUFFICIENT',
      toolCalls: [],
      stopReason: 'end_turn',
    })
    // Second call: actual tool loop
    mockChat.mockResolvedValueOnce({
      text: 'Hello, how can I help?',
      toolCalls: [],
      stopReason: 'end_turn',
    })

    const { runToolLoop } = await import('../../src/toolCaller.js')
    const ctx = makeCtx()
    const result = await runToolLoop(ctx, makeConfig())
    expect(result).toBe('Hello, how can I help?')
  })

  it('handles tool use and returns final text', async () => {
    // silentCapabilityCheck
    mockChat.mockResolvedValueOnce({
      text: 'SUFFICIENT',
      toolCalls: [],
      stopReason: 'end_turn',
    })
    mockChat
      .mockResolvedValueOnce({
        text: '',
        toolCalls: [{ id: 'tu1', name: 'test_tool', arguments: {} }],
        stopReason: 'tool_use',
      })
      .mockResolvedValueOnce({
        text: 'Done using tool.',
        toolCalls: [],
        stopReason: 'end_turn',
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
    // silentCapabilityCheck
    mockChat.mockResolvedValueOnce({
      text: 'SUFFICIENT',
      toolCalls: [],
      stopReason: 'end_turn',
    })
    mockChat.mockResolvedValueOnce({
      text: '',
      toolCalls: [],
      stopReason: 'end_turn',
    })

    const { runToolLoop } = await import('../../src/toolCaller.js')
    const ctx = makeCtx()
    const result = await runToolLoop(ctx, makeConfig())
    expect(result).toBe('Done.')
  })
})
