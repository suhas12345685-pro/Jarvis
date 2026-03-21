import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AppConfig } from '../../src/types/index.js'
import type { MemoryLayer } from '../../src/memoryLayer.js'

// Mock consciousness
vi.mock('../../src/consciousness.js', () => ({
  getConsciousness: () => ({
    think: vi.fn(),
  }),
}))

// Mock logger
vi.mock('../../src/logger.js', () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

// Mock LLM registry
const mockChat = vi.fn()
vi.mock('../../src/llm/registry.js', () => ({
  getProvider: () => ({
    name: 'mock',
    chat: mockChat,
  }),
}))

// Mock config
vi.mock('../../src/config.js', () => ({
  getByoakValue: () => null,
}))

// Mock proactive engine (used by refreshRealTimeKnowledge)
vi.mock('../../src/proactiveEngine.js', () => ({
  listProactiveTasks: () => [],
}))

const makeConfig = (): AppConfig => ({
  port: 3000,
  storageMode: 'sqlite',
  logPath: '/tmp/test.log',
  llmProvider: 'anthropic',
  llmModel: 'claude-sonnet-4-20250514',
  anthropicApiKey: 'test-key',
  byoak: [],
  dbLanguage: 'en',
  sqlitePath: '/tmp/jarvis.db',
  redisUrl: 'redis://localhost:6379',
} as AppConfig)

function makeMemory(): MemoryLayer {
  const memories: { content: string; metadata: Record<string, unknown> }[] = []
  return {
    insertMemory: vi.fn(async (content: string, metadata: Record<string, unknown>) => {
      memories.push({ content, metadata })
      return {
        id: 'mem-' + memories.length,
        content,
        embedding: [],
        metadata,
        createdAt: new Date(),
      }
    }),
    semanticSearch: vi.fn(async () => memories.map((m, i) => ({
      id: 'mem-' + i,
      content: m.content,
      embedding: [],
      metadata: m.metadata,
      createdAt: new Date(),
    }))),
    deleteMemory: vi.fn(),
    close: vi.fn(),
  } as unknown as MemoryLayer
}

describe('learningEngine', () => {
  let initLearningEngine: typeof import('../../src/learningEngine.js').initLearningEngine
  let learnFromInteraction: typeof import('../../src/learningEngine.js').learnFromInteraction
  let learnFromOutcome: typeof import('../../src/learningEngine.js').learnFromOutcome
  let recallRelevantKnowledge: typeof import('../../src/learningEngine.js').recallRelevantKnowledge
  let refreshRealTimeKnowledge: typeof import('../../src/learningEngine.js').refreshRealTimeKnowledge

  beforeEach(async () => {
    vi.resetModules()
    // Re-import after reset to get fresh module state
    const mod = await import('../../src/learningEngine.js')
    initLearningEngine = mod.initLearningEngine
    learnFromInteraction = mod.learnFromInteraction
    learnFromOutcome = mod.learnFromOutcome
    recallRelevantKnowledge = mod.recallRelevantKnowledge
    refreshRealTimeKnowledge = mod.refreshRealTimeKnowledge
  })

  it('returns empty when not initialized', async () => {
    const result = await recallRelevantKnowledge('hello')
    expect(result).toEqual([])
  })

  it('skips learning from short messages', async () => {
    const memory = makeMemory()
    initLearningEngine(makeConfig(), memory)
    await learnFromInteraction('user1', 'hi', 'hello', 'api')
    expect(memory.insertMemory).not.toHaveBeenCalled()
  })

  it('learns from interaction when LLM returns facts', async () => {
    const memory = makeMemory()
    initLearningEngine(makeConfig(), memory)

    mockChat.mockResolvedValueOnce({
      text: 'LEARN: User prefers TypeScript over JavaScript',
      toolCalls: [],
      stopReason: 'end_turn',
    })

    await learnFromInteraction(
      'user1',
      'I always use TypeScript for my projects, never plain JavaScript',
      'That makes sense, TypeScript provides better type safety.',
      'api'
    )

    expect(memory.insertMemory).toHaveBeenCalledWith(
      expect.stringContaining('User prefers TypeScript'),
      expect.objectContaining({ type: 'learned_fact', source: 'interaction' })
    )
  })

  it('learns from outcome and stores in memory', async () => {
    const memory = makeMemory()
    initLearningEngine(makeConfig(), memory)

    await learnFromOutcome('user1', 'web_search', { query: 'test' }, true, 'Found 5 results for test query')

    expect(memory.insertMemory).toHaveBeenCalledWith(
      expect.stringContaining('web_search'),
      expect.objectContaining({ type: 'skill_outcome', succeeded: true })
    )
  })

  it('skips learning from very short outputs', async () => {
    const memory = makeMemory()
    initLearningEngine(makeConfig(), memory)

    await learnFromOutcome('user1', 'test_skill', {}, true, 'ok')
    expect(memory.insertMemory).not.toHaveBeenCalled()
  })

  it('deduplicates repeated learnings', async () => {
    const memory = makeMemory()
    initLearningEngine(makeConfig(), memory)

    await learnFromOutcome('user1', 'skill_a', { x: 1 }, true, 'Result of the first execution here')
    await learnFromOutcome('user1', 'skill_a', { x: 1 }, true, 'Result of the first execution here')

    // Should only insert once due to deduplication
    expect(memory.insertMemory).toHaveBeenCalledTimes(1)
  })

  it('recalls relevant knowledge from memory', async () => {
    const memory = makeMemory()
    initLearningEngine(makeConfig(), memory)

    // Insert something first
    await learnFromOutcome('user1', 'web_search', { q: 'ts' }, true, 'Found TypeScript docs successfully')

    const recalled = await recallRelevantKnowledge('TypeScript', 'user1', 5)
    expect(recalled.length).toBeGreaterThan(0)
  })

  it('refreshRealTimeKnowledge returns insights', async () => {
    const memory = makeMemory()
    initLearningEngine(makeConfig(), memory)

    const insights = await refreshRealTimeKnowledge()
    expect(Array.isArray(insights)).toBe(true)
    expect(insights.length).toBeGreaterThan(0)
    expect(insights[0]).toContain('time awareness')
  })

  it('skips learning when LLM returns NONE', async () => {
    const memory = makeMemory()
    initLearningEngine(makeConfig(), memory)

    mockChat.mockResolvedValueOnce({
      text: 'NONE',
      toolCalls: [],
      stopReason: 'end_turn',
    })

    await learnFromInteraction('user1', 'What is the weather like outside today?', 'Let me check', 'api')
    expect(memory.insertMemory).not.toHaveBeenCalled()
  })

  it('handles LLM errors gracefully during interaction learning', async () => {
    const memory = makeMemory()
    initLearningEngine(makeConfig(), memory)

    mockChat.mockRejectedValueOnce(new Error('API timeout'))

    // Should not throw
    await learnFromInteraction('user1', 'This is a long enough message to learn from today', 'Response', 'api')
    expect(memory.insertMemory).not.toHaveBeenCalled()
  })

  it('handles memory layer errors gracefully during outcome learning', async () => {
    const memory = makeMemory()
    ;(memory.insertMemory as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('DB error'))
    initLearningEngine(makeConfig(), memory)

    // Should not throw even when insertMemory fails
    await learnFromOutcome('user1', 'broken_skill', { a: 1 }, false, 'SMTP connection failed here unexpectedly')
  })

  it('returns empty when memory search fails during recall', async () => {
    const memory = makeMemory()
    ;(memory.semanticSearch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('DB down'))
    initLearningEngine(makeConfig(), memory)

    const result = await recallRelevantKnowledge('anything')
    expect(result).toEqual([])
  })

  it('prioritizes user-specific facts during recall', async () => {
    const memory = makeMemory()
    ;(memory.semanticSearch as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: '1', content: 'General fact', metadata: { userId: 'other' }, embedding: [], createdAt: new Date() },
      { id: '2', content: 'User-specific fact', metadata: { userId: 'user1' }, embedding: [], createdAt: new Date() },
    ])
    initLearningEngine(makeConfig(), memory)

    const recalled = await recallRelevantKnowledge('something', 'user1')
    expect(recalled[0]).toBe('User-specific fact')
  })
})
