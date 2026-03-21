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
  storageMode: 'sqlite',
  sqlitePath: '/tmp/test.db',
  redisUrl: 'redis://localhost:6379',
  port: 3000,
  logPath: '/tmp/test.log',
  byoak: [],
  dbLanguage: 'en',
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

  it('appends proactive care offer when triggered', async () => {
    const { checkProactiveCare } = await import('../../src/skills/proactiveCare.js')
    ;(checkProactiveCare as ReturnType<typeof vi.fn>).mockResolvedValueOnce('Would you like me to order some coffee?')

    // silentCapabilityCheck
    mockChat.mockResolvedValueOnce({
      text: 'SUFFICIENT',
      toolCalls: [],
      stopReason: 'end_turn',
    })
    // Main response
    mockChat.mockResolvedValueOnce({
      text: 'Here is your report.',
      toolCalls: [],
      stopReason: 'end_turn',
    })

    const { runToolLoop } = await import('../../src/toolCaller.js')
    const ctx = makeCtx()
    const result = await runToolLoop(ctx, makeConfig())
    expect(result).toContain('Here is your report.')
    expect(result).toContain('Would you like me to order some coffee?')
  })

  it('injects recalled knowledge into user message', async () => {
    const { recallRelevantKnowledge } = await import('../../src/learningEngine.js')
    ;(recallRelevantKnowledge as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      'User prefers TypeScript',
      'User works at a startup',
    ])

    // silentCapabilityCheck
    mockChat.mockResolvedValueOnce({
      text: 'SUFFICIENT',
      toolCalls: [],
      stopReason: 'end_turn',
    })
    // Main response
    mockChat.mockResolvedValueOnce({
      text: 'Based on your preferences...',
      toolCalls: [],
      stopReason: 'end_turn',
    })

    const { runToolLoop } = await import('../../src/toolCaller.js')
    const ctx = makeCtx()
    await runToolLoop(ctx, makeConfig())

    // The second chat call should include recalled knowledge in the user message
    const mainCall = mockChat.mock.calls[1]
    const userMessage = mainCall[0].messages[0].content
    expect(userMessage).toContain('Recalled from memory')
    expect(userMessage).toContain('TypeScript')
  })

  it('returns error message after consecutive LLM failures', async () => {
    // silentCapabilityCheck
    mockChat.mockResolvedValueOnce({
      text: 'SUFFICIENT',
      toolCalls: [],
      stopReason: 'end_turn',
    })
    // 3 consecutive failures (exceeds limit of 2 retries)
    mockChat.mockRejectedValueOnce(new Error('Rate limit'))
    mockChat.mockRejectedValueOnce(new Error('Rate limit'))
    mockChat.mockRejectedValueOnce(new Error('Rate limit'))

    const { runToolLoop } = await import('../../src/toolCaller.js')
    const ctx = makeCtx()
    const result = await runToolLoop(ctx, makeConfig())
    expect(result).toContain('error communicating with the AI provider')
  })

  it('handles silent capability check with GENERATE response', async () => {
    // silentCapabilityCheck returns GENERATE — this triggers autoGenerateSkill
    // But even if generation doesn't happen (mock returns false), the loop continues
    mockChat.mockResolvedValueOnce({
      text: 'GENERATE|csv_parser|Parse CSV files into JSON',
      toolCalls: [],
      stopReason: 'end_turn',
    })
    // Main response after capability check
    mockChat.mockResolvedValueOnce({
      text: 'I can handle that now.',
      toolCalls: [],
      stopReason: 'end_turn',
    })

    const { runToolLoop } = await import('../../src/toolCaller.js')
    const ctx = makeCtx()
    const result = await runToolLoop(ctx, makeConfig())

    // The tool loop should still complete and return the response
    expect(result).toBe('I can handle that now.')
  })

  it('reaches max rounds and returns depth message', async () => {
    // silentCapabilityCheck
    mockChat.mockResolvedValueOnce({
      text: 'SUFFICIENT',
      toolCalls: [],
      stopReason: 'end_turn',
    })
    // Always return tool calls (never end_turn)
    mockChat.mockResolvedValue({
      text: '',
      toolCalls: [{ id: 'tu1', name: 'test_tool', arguments: {} }],
      stopReason: 'tool_use',
    })

    const { runToolLoop } = await import('../../src/toolCaller.js')
    const ctx = makeCtx()
    const result = await runToolLoop(ctx, makeConfig())
    expect(result).toContain('maximum tool call depth')
  })
})
