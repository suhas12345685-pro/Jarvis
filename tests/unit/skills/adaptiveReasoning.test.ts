import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock all dependencies
vi.mock('../../../src/logger.js', () => ({
  getLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}))

const { mockChat } = vi.hoisted(() => ({ mockChat: vi.fn() }))
vi.mock('../../../src/llm/registry.js', () => ({
  getProvider: vi.fn().mockReturnValue({ chat: mockChat }),
}))

vi.mock('../../../src/config.js', () => ({
  loadConfig: vi.fn().mockReturnValue({
    llmProvider: 'anthropic',
    llmModel: 'claude-sonnet-4-6',
    anthropicApiKey: 'test-key',
    byoak: [],
  }),
  getByoakValue: vi.fn(() => null),
}))

vi.mock('../../../src/consciousness.js', () => ({
  getConsciousness: vi.fn().mockReturnValue({
    think: vi.fn(),
    thinkWithLLM: vi.fn().mockResolvedValue(undefined),
    hasLLM: vi.fn().mockReturnValue(false),
  }),
}))

vi.mock('../../../src/emotionEngine.js', () => ({
  getEmotionEngine: vi.fn().mockReturnValue({
    getOrCreateState: vi.fn().mockReturnValue({ primary: 'neutral', intensity: 0.5, mood: 'calm' }),
  }),
}))

// Mock LangGraph
const mockInvoke = vi.fn()
vi.mock('@langchain/langgraph', () => ({
  StateGraph: vi.fn().mockImplementation(() => ({
    addNode: vi.fn().mockReturnThis(),
    addEdge: vi.fn().mockReturnThis(),
    addConditionalEdges: vi.fn().mockReturnThis(),
    compile: vi.fn().mockReturnValue({ invoke: mockInvoke }),
  })),
  Annotation: {
    Root: vi.fn().mockReturnValue({
      State: {} as any,
    }),
  },
  END: 'END',
  START: 'START',
}))

import { getSkill } from '../../../src/skills/index.js'
import '../../../src/skills/adaptiveReasoning.js'

const ctx: any = { userId: 'u1', channelType: 'test', threadId: 't1', memories: [] }

describe('adaptiveReasoning skill', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInvoke.mockResolvedValue({
      finalResponse: 'This is a well-reasoned response.',
      modeUsed: 'hybrid',
      emotionalRead: 'User seems curious and engaged.',
      confidence: 0.85,
      detectedSignals: 'Technical question with curiosity signals',
    })
  })

  describe('adaptive_reason', () => {
    const skill = getSkill('adaptive_reason')!

    it('returns error for empty input', async () => {
      const res = await skill.handler({ input: '' }, ctx)
      expect(res.isError).toBe(true)
      expect(res.output).toContain('No input')
    })

    it('runs adaptive reasoning graph and returns result', async () => {
      const res = await skill.handler({ input: 'How should I architect a microservices system?' }, ctx)
      expect(res.isError).toBe(false)
      expect(res.output).toContain('well-reasoned response')
      expect(res.output).toContain('Hybrid') // mode label
      expect(res.metadata?.mode).toBe('hybrid')
    })

    it('overrides mode when forced', async () => {
      mockInvoke.mockResolvedValue({
        finalResponse: 'Logical analysis...',
        modeUsed: 'logical',
        emotionalRead: 'Analytical state',
        confidence: 0.9,
        detectedSignals: 'Technical signals',
      })
      const res = await skill.handler({ input: 'Analyze this', mode: 'logical' }, ctx)
      expect(res.isError).toBe(false)
      expect(res.metadata?.mode).toBe('logical')
    })

    it('passes context to graph', async () => {
      await skill.handler({ input: 'Help me', context: 'Working on a React app' }, ctx)
      expect(mockInvoke).toHaveBeenCalledWith(expect.objectContaining({
        input: 'Help me',
        context: 'Working on a React app',
      }))
    })

    it('handles graph errors gracefully', async () => {
      mockInvoke.mockRejectedValue(new Error('LLM timeout'))
      const res = await skill.handler({ input: 'test query' }, ctx)
      expect(res.isError).toBe(true)
      expect(res.output).toContain('Reasoning failed')
    })
  })
})
