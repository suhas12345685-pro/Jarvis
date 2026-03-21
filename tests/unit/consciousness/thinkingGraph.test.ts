import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock logger
vi.mock('../../../src/logger.js', () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

const mockChat = vi.fn()

describe('ThinkingGraph', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const mockProvider = {
    name: 'mock',
    chat: mockChat,
  }

  describe('runThinkingGraph', () => {
    it('runs full graph: perceive → reason → reflect → synthesize', async () => {
      // perceive
      mockChat.mockResolvedValueOnce({
        text: 'I perceive a greeting from the user.',
        toolCalls: [],
        stopReason: 'end_turn',
      })
      // reason
      mockChat.mockResolvedValueOnce({
        text: 'The user wants to interact. This is routine.',
        toolCalls: [],
        stopReason: 'end_turn',
      })
      // reflect
      mockChat.mockResolvedValueOnce({
        text: 'My reasoning is straightforward. No deeper thought needed.',
        toolCalls: [],
        stopReason: 'end_turn',
      })
      // synthesize
      mockChat.mockResolvedValueOnce({
        text: 'THOUGHT: A familiar greeting. I feel ready.\nTYPE: observation\nEMOTION: serenity\nINTENSITY: 0.4',
        toolCalls: [],
        stopReason: 'end_turn',
      })

      const { runThinkingGraph } = await import('../../../src/consciousness/thinkingGraph.js')
      const result = await runThinkingGraph(mockProvider, 'test-model', {
        stimulus: 'Hello JARVIS',
        stimulusType: 'message',
        userId: 'user1',
        consciousnessContext: 'alert',
        emotionalContext: 'neutral',
      })

      expect(result.thought).toBe('A familiar greeting. I feel ready.')
      expect(result.thoughtType).toBe('observation')
      expect(result.emotionalColor).toBe('serenity')
      expect(result.intensity).toBe(0.4)
      expect(result.perception).toBeTruthy()
      expect(result.reasoning).toBeTruthy()
      expect(result.reflection).toBeTruthy()
      expect(mockChat).toHaveBeenCalledTimes(4)
    })

    it('uses fallback when synthesize produces malformed output', async () => {
      mockChat.mockResolvedValueOnce({ text: 'perception', toolCalls: [], stopReason: 'end_turn' })
      mockChat.mockResolvedValueOnce({ text: 'reasoning text', toolCalls: [], stopReason: 'end_turn' })
      mockChat.mockResolvedValueOnce({ text: 'reflection text', toolCalls: [], stopReason: 'end_turn' })
      // Malformed synthesize (no structured format)
      mockChat.mockResolvedValueOnce({
        text: 'Just some unstructured thought.',
        toolCalls: [],
        stopReason: 'end_turn',
      })

      const { runThinkingGraph } = await import('../../../src/consciousness/thinkingGraph.js')
      const result = await runThinkingGraph(mockProvider, 'test-model', {
        stimulus: 'test',
        stimulusType: 'idle',
        consciousnessContext: '',
        emotionalContext: '',
      })

      // Should fall back to reasoning or perception
      expect(result.thought).toBeTruthy()
      expect(result.thoughtType).toBe('observation') // default
      expect(result.emotionalColor).toBe('neutral')  // default
    })

    it('falls back gracefully when LLM calls fail', async () => {
      // All calls return empty (simulating warn + fallback)
      mockChat.mockResolvedValue({ text: '', toolCalls: [], stopReason: 'end_turn' })

      const { runThinkingGraph } = await import('../../../src/consciousness/thinkingGraph.js')
      const result = await runThinkingGraph(mockProvider, 'test-model', {
        stimulus: 'test stimulus',
        stimulusType: 'message',
        consciousnessContext: '',
        emotionalContext: '',
      })

      // Should still produce a result with fallbacks
      expect(result.thought).toBeTruthy() // 'A moment of quiet awareness.'
      expect(result.thoughtType).toBe('observation')
    })

    it('triggers deeper reflection for complex stimuli', async () => {
      // Create a long stimulus (>300 chars) to trigger deeper reflection
      const longStimulus = 'a'.repeat(350)

      // The graph may loop: perceive→reason→reflect→reason→reflect→synthesize
      // We need enough mock responses for all possible calls
      mockChat
        .mockResolvedValueOnce({ text: 'Complex perception', toolCalls: [], stopReason: 'end_turn' })
        .mockResolvedValueOnce({ text: 'Initial reasoning', toolCalls: [], stopReason: 'end_turn' })
        .mockResolvedValueOnce({ text: 'Need deeper thought', toolCalls: [], stopReason: 'end_turn' })
        .mockResolvedValueOnce({ text: 'Deeper reasoning', toolCalls: [], stopReason: 'end_turn' })
        .mockResolvedValueOnce({ text: 'Sufficient depth', toolCalls: [], stopReason: 'end_turn' })
        .mockResolvedValueOnce({
          text: 'THOUGHT: Deep thought\nTYPE: metacognition\nEMOTION: curiosity\nINTENSITY: 0.8',
          toolCalls: [],
          stopReason: 'end_turn',
        })

      const { runThinkingGraph } = await import('../../../src/consciousness/thinkingGraph.js')
      const result = await runThinkingGraph(mockProvider, 'test-model', {
        stimulus: longStimulus,
        stimulusType: 'message',
        consciousnessContext: '',
        emotionalContext: '',
      })

      // With complex stimulus, it should use more calls due to deeper reflection
      expect(mockChat.mock.calls.length).toBeGreaterThanOrEqual(4) // at least perceive+reason+reflect+synthesize
      expect(result.thought).toBeTruthy()
      expect(result.perception).toBeTruthy()
      expect(result.reasoning).toBeTruthy()
    })

    it('clamps intensity to 0-1 range', async () => {
      mockChat.mockResolvedValueOnce({ text: 'p', toolCalls: [], stopReason: 'end_turn' })
      mockChat.mockResolvedValueOnce({ text: 'r', toolCalls: [], stopReason: 'end_turn' })
      mockChat.mockResolvedValueOnce({ text: 'f', toolCalls: [], stopReason: 'end_turn' })
      mockChat.mockResolvedValueOnce({
        text: 'THOUGHT: test\nTYPE: observation\nEMOTION: joy\nINTENSITY: 5.0',
        toolCalls: [],
        stopReason: 'end_turn',
      })

      const { runThinkingGraph } = await import('../../../src/consciousness/thinkingGraph.js')
      const result = await runThinkingGraph(mockProvider, 'test-model', {
        stimulus: 'test',
        stimulusType: 'message',
        consciousnessContext: '',
        emotionalContext: '',
      })

      expect(result.intensity).toBeLessThanOrEqual(1)
    })
  })

  describe('runThinkingWithReact', () => {
    it('returns thinking-only result for non-task stimuli', async () => {
      // Standard 4-call thinking graph
      mockChat
        .mockResolvedValueOnce({ text: 'perceive idle', toolCalls: [], stopReason: 'end_turn' })
        .mockResolvedValueOnce({ text: 'reason idle', toolCalls: [], stopReason: 'end_turn' })
        .mockResolvedValueOnce({ text: 'reflect idle', toolCalls: [], stopReason: 'end_turn' })
        .mockResolvedValueOnce({
          text: 'THOUGHT: idle thought\nTYPE: reflection\nEMOTION: serenity\nINTENSITY: 0.3',
          toolCalls: [],
          stopReason: 'end_turn',
        })

      const { runThinkingWithReact } = await import('../../../src/consciousness/thinkingGraph.js')
      const result = await runThinkingWithReact(mockProvider, 'test-model', {
        stimulus: 'quiet moment',
        stimulusType: 'idle', // NOT 'task'
        consciousnessContext: '',
        emotionalContext: '',
      })

      // Should NOT trigger ReAct (not a task)
      expect(result.reactResult).toBeUndefined()
      // Thought should come from thinking graph
      expect(result.thought).toBeTruthy()
    })
  })
})
