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

import {
  classifyFast,
  classifyHeuristic,
  classifyWithLLM,
  classifyBatch,
  type MemoryType,
} from '../../../src/consciousness/memoryClassifier.js'

describe('MemoryClassifier', () => {
  describe('classifyFast', () => {
    it('detects procedural content', () => {
      const result = classifyFast('Step 1: install Node.js. Step 2: run npm install.')
      expect(result.type).toBe('procedural')
      expect(result.confidence).toBeGreaterThan(0.5)
    })

    it('detects emotional content', () => {
      const result = classifyFast('I feel really excited about this project')
      expect(result.type).toBe('emotional')
      expect(result.confidence).toBeGreaterThan(0.5)
    })

    it('detects episodic content', () => {
      const result = classifyFast('Yesterday I met with the team and we discussed the roadmap')
      expect(result.type).toBe('episodic')
      expect(result.confidence).toBeGreaterThan(0.5)
    })

    it('defaults to semantic for factual content', () => {
      const result = classifyFast('TypeScript is a superset of JavaScript')
      expect(result.type).toBe('semantic')
    })

    it('returns low confidence for ambiguous content', () => {
      const result = classifyFast('hello world')
      expect(result.confidence).toBeLessThanOrEqual(0.5)
    })
  })

  describe('classifyHeuristic', () => {
    it('returns full ClassifiedMemory with tags', () => {
      const result = classifyHeuristic('Step 1: configure the database connection string')
      expect(result.type).toBe('procedural')
      expect(result.content).toContain('database')
      expect(result.tags).toBeInstanceOf(Array)
      expect(result.importance).toBeGreaterThan(0)
    })

    it('assigns higher importance to procedural memories', () => {
      const procedural = classifyHeuristic('First install deps, then build the project')
      const semantic = classifyHeuristic('The capital of France is Paris')
      expect(procedural.importance).toBeGreaterThanOrEqual(semantic.importance)
    })
  })

  describe('classifyWithLLM', () => {
    const mockProvider = {
      name: 'mock',
      chat: vi.fn(),
    }

    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('parses LLM classification response', async () => {
      mockProvider.chat.mockResolvedValueOnce({
        text: 'TYPE: episodic\nIMPORTANCE: 0.8\nTAGS: meeting, team, roadmap',
        toolCalls: [],
        stopReason: 'end_turn',
      })

      const result = await classifyWithLLM('Met with the team yesterday', mockProvider, 'test-model')
      expect(result.type).toBe('episodic')
      expect(result.importance).toBe(0.8)
      expect(result.tags).toEqual(['meeting', 'team', 'roadmap'])
      expect(result.confidence).toBe(0.9)
    })

    it('falls back to heuristic on LLM error', async () => {
      mockProvider.chat.mockRejectedValueOnce(new Error('API error'))

      const result = await classifyWithLLM('Step 1: install Node.js', mockProvider, 'test-model')
      expect(result.type).toBe('procedural') // heuristic fallback
      expect(result.confidence).toBeLessThan(0.9) // lower than LLM confidence
    })
  })

  describe('classifyBatch', () => {
    it('classifies multiple items with heuristic when no provider', async () => {
      const results = await classifyBatch([
        'Yesterday we had a meeting',
        'Step 1: install deps',
        'I feel really happy and excited about life',
      ])

      expect(results).toHaveLength(3)
      expect(results[0].type).toBe('episodic')
      expect(results[1].type).toBe('procedural')
      expect(results[2].type).toBe('emotional')
    })

    it('uses LLM when provider is available', async () => {
      const mockProvider = {
        name: 'mock',
        chat: vi.fn().mockResolvedValue({
          text: 'TYPE: semantic\nIMPORTANCE: 0.6\nTAGS: fact',
          toolCalls: [],
          stopReason: 'end_turn',
        }),
      }

      const results = await classifyBatch(['fact one', 'fact two'], mockProvider, 'model')
      expect(results).toHaveLength(2)
      expect(mockProvider.chat).toHaveBeenCalledTimes(2)
    })
  })
})
