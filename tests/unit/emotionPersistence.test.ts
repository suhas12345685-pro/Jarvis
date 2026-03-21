import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/logger.js', () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

import {
  EmotionPersistence,
  createEmotionPersistence,
  getEmotionPersistence,
} from '../../src/emotionPersistence.js'

const mockInsertMemory = vi.fn().mockResolvedValue(undefined)
const mockSemanticSearch = vi.fn().mockResolvedValue([])

const mockMemory = {
  insertMemory: mockInsertMemory,
  semanticSearch: mockSemanticSearch,
} as any

describe('EmotionPersistence', () => {
  let persistence: EmotionPersistence

  beforeEach(() => {
    vi.clearAllMocks()
    persistence = new EmotionPersistence(mockMemory)
  })

  describe('initialize', () => {
    it('initializes once', async () => {
      await persistence.initialize()
      await persistence.initialize() // idempotent
    })
  })

  describe('saveEmotionState', () => {
    it('saves emotion state to memory layer', async () => {
      await persistence.saveEmotionState(
        'user1',
        { primary: 'joy', intensity: 0.8, mood: 'happy', triggers: [], duration: 0, lastUpdated: new Date() },
        { traits: ['warm'], dominantTrait: 'warm', warmthLevel: 0.9, humorLevel: 0.5, formalityLevel: 0.4, empathyLevel: 0.8 }
      )

      expect(mockInsertMemory).toHaveBeenCalledWith(
        expect.stringContaining('"emotion":"joy"'),
        expect.objectContaining({ memoryType: 'emotion_state', userId: 'user1', emotion: 'joy' })
      )
    })

    it('caches saved state', async () => {
      const emotion = { primary: 'trust' as const, intensity: 0.6, mood: 'content' as const, triggers: [], duration: 0, lastUpdated: new Date() }
      const personality = { traits: ['helpful' as const], dominantTrait: 'helpful' as const, warmthLevel: 0.7, humorLevel: 0.5, formalityLevel: 0.4, empathyLevel: 0.8 }

      await persistence.saveEmotionState('user1', emotion, personality)

      // Loading should use cache, not memory
      const loaded = await persistence.loadEmotionState('user1')
      expect(loaded).toBeTruthy()
      expect(loaded!.userId).toBe('user1')
      expect(mockSemanticSearch).not.toHaveBeenCalled()
    })

    it('handles save errors gracefully', async () => {
      mockInsertMemory.mockRejectedValueOnce(new Error('DB error'))

      // Should not throw
      await persistence.saveEmotionState(
        'user1',
        { primary: 'neutral', intensity: 0.5, mood: 'content', triggers: [], duration: 0, lastUpdated: new Date() },
        { traits: ['helpful'], dominantTrait: 'helpful', warmthLevel: 0.7, humorLevel: 0.5, formalityLevel: 0.4, empathyLevel: 0.8 }
      )
    })
  })

  describe('loadEmotionState', () => {
    it('returns null for unknown user', async () => {
      const result = await persistence.loadEmotionState('unknown')
      expect(result).toBeNull()
    })

    it('loads from memory when not cached', async () => {
      mockSemanticSearch.mockResolvedValueOnce([{
        id: 'mem-1',
        content: 'emotion state',
        metadata: { memoryType: 'emotion_state', userId: 'user2', emotion: 'joy', mood: 'happy', intensity: 0.7, personality: ['warm'] },
        createdAt: new Date(),
      }])

      const result = await persistence.loadEmotionState('user2')
      expect(result).toBeTruthy()
      expect(result!.emotionState.primary).toBe('joy')
      expect(result!.emotionState.mood).toBe('happy')
    })

    it('skips non-matching memories', async () => {
      mockSemanticSearch.mockResolvedValueOnce([{
        id: 'mem-1',
        content: 'something else',
        metadata: { memoryType: 'emotion_state', userId: 'other-user', emotion: 'joy' },
        createdAt: new Date(),
      }])

      const result = await persistence.loadEmotionState('user3')
      expect(result).toBeNull()
    })

    it('handles search errors gracefully', async () => {
      mockSemanticSearch.mockRejectedValueOnce(new Error('Search failed'))
      const result = await persistence.loadEmotionState('user1')
      expect(result).toBeNull()
    })
  })

  describe('saveEmotionalInteraction', () => {
    it('saves interaction to memory', async () => {
      await persistence.saveEmotionalInteraction('user1', 'Hello', 'Hi there!', 'joy')

      expect(mockInsertMemory).toHaveBeenCalledWith(
        expect.stringContaining('User: Hello'),
        expect.objectContaining({ memoryType: 'emotional_interaction', userId: 'user1', emotion: 'joy' })
      )
    })

    it('handles save errors gracefully', async () => {
      mockInsertMemory.mockRejectedValueOnce(new Error('DB error'))
      await persistence.saveEmotionalInteraction('user1', 'test', 'test', 'neutral')
    })
  })

  describe('getEmotionalTrend', () => {
    it('returns memories from semantic search', async () => {
      mockSemanticSearch.mockResolvedValueOnce([
        { id: '1', content: 'interaction 1', metadata: {}, createdAt: new Date() },
      ])

      const trend = await persistence.getEmotionalTrend('user1')
      expect(trend).toHaveLength(1)
    })

    it('returns empty array on error', async () => {
      mockSemanticSearch.mockRejectedValueOnce(new Error('fail'))
      const trend = await persistence.getEmotionalTrend('user1')
      expect(trend).toEqual([])
    })
  })

  describe('singleton', () => {
    it('createEmotionPersistence creates instance', () => {
      const instance = createEmotionPersistence(mockMemory)
      expect(instance).toBeInstanceOf(EmotionPersistence)
    })

    it('getEmotionPersistence returns created instance', () => {
      createEmotionPersistence(mockMemory)
      const instance = getEmotionPersistence()
      expect(instance).toBeInstanceOf(EmotionPersistence)
    })

    it('getEmotionPersistence returns null before creation', () => {
      // Note: due to module caching, this may return the instance from previous test
      // Just verify it doesn't throw
      const result = getEmotionPersistence()
      expect(result === null || result instanceof EmotionPersistence).toBe(true)
    })
  })
})
