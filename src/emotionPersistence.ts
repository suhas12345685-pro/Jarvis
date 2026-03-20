import type { AppConfig } from './types/index.js'
import type { MemoryLayer } from './memoryLayer.js'
import type { Memory } from './types/agent.js'
import type { EmotionState, PersonalityProfile } from './types/emotions.js'
import { getLogger } from './logger.js'

interface EmotionPersistenceEntry {
  id: string
  userId: string
  emotionState: EmotionState
  personality: PersonalityProfile
  updatedAt: string
}

export class EmotionPersistence {
  private memory: MemoryLayer
  private cache: Map<string, EmotionPersistenceEntry> = new Map()
  private initialized = false

  constructor(memory: MemoryLayer) {
    this.memory = memory
  }

  async initialize(): Promise<void> {
    if (this.initialized) return
    this.initialized = true
    getLogger().info('Emotion persistence layer initialized')
  }

  async saveEmotionState(
    userId: string,
    emotionState: EmotionState,
    personality: PersonalityProfile
  ): Promise<void> {
    const entry: EmotionPersistenceEntry = {
      id: `emotion-${userId}`,
      userId,
      emotionState,
      personality,
      updatedAt: new Date().toISOString(),
    }

    try {
      await this.memory.insertMemory(
        JSON.stringify({
          type: 'emotion_state',
          userId,
          emotion: emotionState.primary,
          mood: emotionState.mood,
          intensity: emotionState.intensity,
          personality: personality.traits,
        }),
        {
          memoryType: 'emotion_state',
          userId,
          emotion: emotionState.primary,
          mood: emotionState.mood,
        }
      )

      this.cache.set(userId, entry)
    } catch (err) {
      getLogger().warn('Failed to persist emotion state', { userId, error: err })
    }
  }

  async loadEmotionState(userId: string): Promise<EmotionPersistenceEntry | null> {
    if (this.cache.has(userId)) {
      return this.cache.get(userId)!
    }

    try {
      const memories = await this.memory.semanticSearch(
        `emotion state for ${userId}`,
        1
      )

      for (const memory of memories) {
        const meta = memory.metadata as Record<string, unknown>
        if (meta.memoryType === 'emotion_state' && meta.userId === userId) {
          const entry: EmotionPersistenceEntry = {
            id: memory.id,
            userId,
            emotionState: {
              primary: meta.emotion as EmotionState['primary'],
              intensity: meta.intensity as number,
              mood: meta.mood as EmotionState['mood'],
              triggers: [],
              duration: 0,
              lastUpdated: new Date(memory.createdAt),
            },
            personality: {
              traits: meta.personality as PersonalityProfile['traits'],
              dominantTrait: 'helpful',
              warmthLevel: 0.7,
              humorLevel: 0.5,
              formalityLevel: 0.4,
              empathyLevel: 0.8,
            },
            updatedAt: memory.createdAt.toISOString(),
          }

          this.cache.set(userId, entry)
          return entry
        }
      }
    } catch (err) {
      getLogger().warn('Failed to load emotion state', { userId, error: err })
    }

    return null
  }

  async saveEmotionalInteraction(
    userId: string,
    userMessage: string,
    assistantResponse: string,
    emotion: string
  ): Promise<void> {
    try {
      await this.memory.insertMemory(
        `User: ${userMessage}\nAssistant: ${assistantResponse}`,
        {
          memoryType: 'emotional_interaction',
          userId,
          emotion,
          timestamp: new Date().toISOString(),
        }
      )
    } catch (err) {
      getLogger().warn('Failed to save emotional interaction', { error: err })
    }
  }

  async getEmotionalTrend(userId: string, limit = 10): Promise<Memory[]> {
    try {
      return await this.memory.semanticSearch(
        `emotional interactions for ${userId}`,
        limit
      )
    } catch {
      return []
    }
  }
}

let persistenceInstance: EmotionPersistence | null = null

export function createEmotionPersistence(memory: MemoryLayer): EmotionPersistence {
  persistenceInstance = new EmotionPersistence(memory)
  return persistenceInstance
}

export function getEmotionPersistence(): EmotionPersistence | null {
  return persistenceInstance
}
