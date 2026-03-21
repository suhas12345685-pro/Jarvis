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

import { FederatedMemoryManager } from '../../../src/consciousness/federatedMemory.js'
import type { MemoryLayer } from '../../../src/memoryLayer.js'
import type { Memory } from '../../../src/types/agent.js'

function createMockMemory(content: string, metadata: Record<string, unknown> = {}): Memory {
  return {
    id: Math.random().toString(36).slice(2),
    content,
    embedding: [],
    metadata,
    createdAt: new Date(),
  }
}

function createMockMemoryLayer(): MemoryLayer {
  return {
    insertMemory: vi.fn().mockResolvedValue(undefined),
    semanticSearch: vi.fn().mockResolvedValue([]),
    deleteMemory: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as MemoryLayer
}

describe('FederatedMemoryManager', () => {
  let mockMemory: MemoryLayer
  let fm: FederatedMemoryManager

  beforeEach(() => {
    vi.clearAllMocks()
    mockMemory = createMockMemoryLayer()
    fm = new FederatedMemoryManager(mockMemory)
  })

  describe('store', () => {
    it('classifies and stores a memory with heuristic (no provider)', async () => {
      const result = await fm.store('Step 1: install deps. Step 2: build.', 'user1')

      expect(result.type).toBe('procedural')
      expect(result.importance).toBeGreaterThan(0)
      expect(mockMemory.insertMemory).toHaveBeenCalledOnce()

      const [content, metadata] = (mockMemory.insertMemory as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(content).toContain('install deps')
      expect(metadata.memoryType).toBe('procedural')
      expect(metadata.userId).toBe('user1')
    })

    it('uses LLM classification when provider is available', async () => {
      const mockProvider = {
        name: 'mock',
        chat: vi.fn().mockResolvedValueOnce({
          text: 'TYPE: episodic\nIMPORTANCE: 0.9\nTAGS: event, team',
          toolCalls: [],
          stopReason: 'end_turn',
        }),
      }

      const fmWithLLM = new FederatedMemoryManager(mockMemory, mockProvider, 'test-model')
      const result = await fmWithLLM.store('Had a team meeting about Q4 goals')

      expect(result.type).toBe('episodic')
      expect(result.confidence).toBe(0.9)
      expect(mockProvider.chat).toHaveBeenCalledOnce()
    })
  })

  describe('search', () => {
    it('returns results with type filtering', async () => {
      ;(mockMemory.semanticSearch as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        createMockMemory('fact one', { memoryType: 'semantic', importance: 0.7 }),
        createMockMemory('event one', { memoryType: 'episodic', importance: 0.6 }),
        createMockMemory('fact two', { memoryType: 'semantic', importance: 0.8 }),
      ])

      const results = await fm.search('test query', { types: ['semantic'] })

      expect(results).toHaveLength(2)
      expect(results.every(r => r.type === 'semantic')).toBe(true)
    })

    it('filters by minimum importance', async () => {
      ;(mockMemory.semanticSearch as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        createMockMemory('important', { memoryType: 'semantic', importance: 0.9 }),
        createMockMemory('not important', { memoryType: 'semantic', importance: 0.2 }),
      ])

      const results = await fm.search('test', { minImportance: 0.5 })
      expect(results).toHaveLength(1)
      expect(results[0].content).toBe('important')
    })

    it('applies type boost to scoring', async () => {
      ;(mockMemory.semanticSearch as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        createMockMemory('procedure', { memoryType: 'procedural', importance: 0.5 }),
        createMockMemory('fact', { memoryType: 'semantic', importance: 0.5 }),
      ])

      const results = await fm.search('how to', {
        boostTypes: { procedural: 2.0 },
      })

      expect(results[0].content).toBe('procedure')
      expect(results[0].score).toBeGreaterThan(results[1].score)
    })

    it('filters by userId', async () => {
      ;(mockMemory.semanticSearch as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        createMockMemory('user1 fact', { memoryType: 'semantic', importance: 0.5, userId: 'user1' }),
        createMockMemory('user2 fact', { memoryType: 'semantic', importance: 0.5, userId: 'user2' }),
      ])

      const results = await fm.search('fact', { userId: 'user1' })
      expect(results).toHaveLength(1)
      expect(results[0].metadata.userId).toBe('user1')
    })
  })

  describe('convenience methods', () => {
    it('recallProcedure filters to procedural type', async () => {
      ;(mockMemory.semanticSearch as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        createMockMemory('how to deploy', { memoryType: 'procedural', importance: 0.8 }),
        createMockMemory('deployment happened', { memoryType: 'episodic', importance: 0.6 }),
      ])

      const procedures = await fm.recallProcedure('deploy')
      expect(procedures).toHaveLength(1)
      expect(procedures[0]).toContain('how to deploy')
    })

    it('recallContext returns formatted string', async () => {
      ;(mockMemory.semanticSearch as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        createMockMemory('fact one', { memoryType: 'semantic', importance: 0.7 }),
        createMockMemory('event one', { memoryType: 'episodic', importance: 0.6 }),
      ])

      const context = await fm.recallContext('test')
      expect(context).toContain('[semantic]')
      expect(context).toContain('[episodic]')
      expect(context).toContain('fact one')
    })

    it('recallContext returns empty string when no results', async () => {
      ;(mockMemory.semanticSearch as ReturnType<typeof vi.fn>).mockResolvedValueOnce([])
      const context = await fm.recallContext('nothing')
      expect(context).toBe('')
    })
  })
})
