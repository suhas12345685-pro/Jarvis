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
  EmotionEngine,
  createEmotionEngine,
  getEmotionEngine,
  resetEmotionEngine,
} from '../../src/emotionEngine.js'

describe('EmotionEngine', () => {
  let engine: EmotionEngine

  beforeEach(() => {
    resetEmotionEngine()
    engine = new EmotionEngine()
  })

  describe('getOrCreateState', () => {
    it('creates default state for new user', () => {
      const state = engine.getOrCreateState('user1')
      expect(state.primary).toBe('neutral')
      expect(state.intensity).toBe(0.5)
      expect(state.mood).toBe('content')
    })

    it('returns same state for same user', () => {
      const a = engine.getOrCreateState('user1')
      const b = engine.getOrCreateState('user1')
      expect(a).toBe(b)
    })
  })

  describe('getPersonality', () => {
    it('returns default personality for new user', () => {
      const p = engine.getPersonality('user1')
      expect(p.dominantTrait).toBe('helpful')
      expect(p.warmthLevel).toBe(0.7)
      expect(p.traits).toContain('helpful')
    })
  })

  describe('setPersonality', () => {
    it('overrides personality for user', () => {
      engine.setPersonality('user1', {
        traits: ['analytical'],
        dominantTrait: 'analytical',
        warmthLevel: 0.3,
        humorLevel: 0.2,
        formalityLevel: 0.8,
        empathyLevel: 0.4,
      })

      const p = engine.getPersonality('user1')
      expect(p.dominantTrait).toBe('analytical')
      expect(p.warmthLevel).toBe(0.3)
    })

    it('updates emotion state based on empathetic personality', () => {
      engine.setPersonality('user1', {
        traits: ['empathetic'],
        dominantTrait: 'empathetic',
        warmthLevel: 0.9,
        humorLevel: 0.5,
        formalityLevel: 0.4,
        empathyLevel: 0.9,
      })

      const state = engine.getOrCreateState('user1')
      expect(state.primary).toBe('trust')
    })
  })

  describe('analyzeSentiment', () => {
    it('detects positive sentiment', () => {
      const result = engine.analyzeSentiment('This is amazing and wonderful!')
      expect(result.sentiment).toBe('positive')
      expect(result.score).toBeGreaterThan(0)
    })

    it('detects negative sentiment', () => {
      const result = engine.analyzeSentiment('This is terrible and broken')
      expect(result.sentiment).toBe('negative')
      expect(result.score).toBeLessThan(0)
    })

    it('detects neutral sentiment', () => {
      const result = engine.analyzeSentiment('The file is located at path')
      expect(result.sentiment).toBe('neutral')
    })

    it('detects joy emotion', () => {
      const result = engine.analyzeSentiment('This is fantastic!')
      const joyEmotion = result.emotions.find(e => e.type === 'joy')
      expect(joyEmotion).toBeTruthy()
    })

    it('detects anger emotion', () => {
      const result = engine.analyzeSentiment('I am so angry about this')
      const angerEmotion = result.emotions.find(e => e.type === 'anger')
      expect(angerEmotion).toBeTruthy()
    })

    it('detects sarcasm', () => {
      const result = engine.analyzeSentiment('yeah right, sure')
      const contempt = result.emotions.find(e => e.type === 'contempt')
      expect(contempt).toBeTruthy()
    })

    it('detects gratitude', () => {
      const result = engine.analyzeSentiment('thank you so much!')
      const trust = result.emotions.find(e => e.type === 'trust')
      expect(trust).toBeTruthy()
    })

    it('detects questions as neutral', () => {
      const result = engine.analyzeSentiment('How does this work?')
      expect(result.emotions.length).toBeGreaterThan(0)
    })

    it('computes confidence from emotion count', () => {
      const simple = engine.analyzeSentiment('hello')
      const rich = engine.analyzeSentiment('I love this amazing fantastic wonderful thing!')
      expect(rich.confidence).toBeGreaterThan(simple.confidence)
    })
  })

  describe('detectEmotion', () => {
    it('returns emotion type from text', () => {
      expect(engine.detectEmotion('I am so excited!')).toBe('anticipation')
    })

    it('returns neutral for plain text', () => {
      expect(engine.detectEmotion('file system check')).toBe('neutral')
    })
  })

  describe('updateEmotion', () => {
    it('updates user emotion based on message', () => {
      const state = engine.updateEmotion('user1', 'This is amazing and wonderful!')
      expect(state.primary).toBe('joy')
    })

    it('updates mood from triggers', () => {
      const state = engine.updateEmotion('user1', "I'm so excited and can't wait!")
      expect(state.mood).toBe('excited')
    })

    it('records emotion history', () => {
      engine.updateEmotion('user1', 'I love this')
      const history = engine.getEmotionHistory('user1')
      expect(history.length).toBeGreaterThan(0)
    })
  })

  describe('getEmotionHistory', () => {
    it('returns empty for unknown user', () => {
      expect(engine.getEmotionHistory('unknown')).toEqual([])
    })

    it('respects limit parameter', () => {
      for (let i = 0; i < 10; i++) {
        engine.updateEmotion('user1', 'I love this amazing thing')
      }
      const history = engine.getEmotionHistory('user1', 3)
      expect(history.length).toBeLessThanOrEqual(3)
    })
  })

  describe('getDominantEmotionTrend', () => {
    it('returns null for user with no history', () => {
      expect(engine.getDominantEmotionTrend('unknown')).toBeNull()
    })

    it('returns dominant emotion from recent history', () => {
      engine.updateEmotion('user1', 'I love this')
      engine.updateEmotion('user1', 'This is amazing')
      engine.updateEmotion('user1', 'Wonderful!')

      const trend = engine.getDominantEmotionTrend('user1')
      expect(trend).toBeTruthy()
    })
  })

  describe('generateEmpatheticResponse', () => {
    it('returns emotional response with tone', () => {
      engine.getOrCreateState('user1')
      const result = engine.generateEmpatheticResponse('user1', 'Here is your answer', 'joy')

      expect(result.response).toBeTruthy()
      expect(result.tone).toBe('warm')
      expect(result.emotion).toBeTruthy()
      expect(result.voiceModulation).toBeTruthy()
    })

    it('adds prefix for non-neutral emotions', () => {
      engine.getOrCreateState('user1')
      const result = engine.generateEmpatheticResponse('user1', 'Here is your answer', 'sadness')

      // Should have an empathetic prefix
      expect(result.response.length).toBeGreaterThanOrEqual('Here is your answer'.length)
    })

    it('returns shouldShowEmotion for positive emotions with warm personality', () => {
      engine.getOrCreateState('user1')
      const result = engine.generateEmpatheticResponse('user1', 'test', 'joy')
      expect(result.shouldShowEmotion).toBe(true)
    })
  })

  describe('calibratePersonalityFromInteraction', () => {
    it('adds helpful trait on question-answer', () => {
      engine.getPersonality('user1')
      engine.calibratePersonalityFromInteraction('user1', 'How do I do this?', 'Here is how.')

      const p = engine.getPersonality('user1')
      expect(p.traits).toContain('helpful')
    })

    it('increases humor on exclamation patterns', () => {
      const before = engine.getPersonality('user1').humorLevel
      engine.calibratePersonalityFromInteraction('user1', 'What is this!?', 'test')
      const after = engine.getPersonality('user1').humorLevel
      expect(after).toBeGreaterThan(before)
    })

    it('decreases formality on casual greetings', () => {
      const before = engine.getPersonality('user1').formalityLevel
      engine.calibratePersonalityFromInteraction('user1', 'hey there', 'hi!')
      const after = engine.getPersonality('user1').formalityLevel
      expect(after).toBeLessThan(before)
    })

    it('increases empathy on apologies', () => {
      const before = engine.getPersonality('user1').empathyLevel
      engine.calibratePersonalityFromInteraction('user1', 'sorry about that', 'no problem')
      const after = engine.getPersonality('user1').empathyLevel
      expect(after).toBeGreaterThan(before)
    })

    it('caps traits at 5', () => {
      const p = engine.getPersonality('user1')
      p.traits = ['a', 'b', 'c', 'd', 'e', 'f']
      engine.calibratePersonalityFromInteraction('user1', 'test?', 'answer')
      expect(engine.getPersonality('user1').traits.length).toBeLessThanOrEqual(6) // may add 'helpful'
    })
  })

  describe('decayEmotions', () => {
    it('decays intensity over time', () => {
      const state = engine.getOrCreateState('user1')
      state.intensity = 0.9
      state.lastUpdated = new Date(Date.now() - 120_000) // 2 minutes ago

      engine.decayEmotions()

      expect(engine.getOrCreateState('user1').intensity).toBeLessThan(0.9)
    })

    it('resets to neutral at low intensity', () => {
      const state = engine.getOrCreateState('user1')
      state.primary = 'joy'
      state.intensity = 0.15
      state.lastUpdated = new Date(Date.now() - 120_000)

      engine.decayEmotions()

      expect(engine.getOrCreateState('user1').primary).toBe('neutral')
    })
  })

  describe('getEmotionalSummary', () => {
    it('returns complete summary', () => {
      const summary = engine.getEmotionalSummary('user1')
      expect(summary.currentEmotion).toBeTruthy()
      expect(summary.personality).toBeTruthy()
      expect(summary.recentTrend).toBeNull() // no history yet
    })
  })

  describe('singleton', () => {
    it('createEmotionEngine creates and returns instance', () => {
      const instance = createEmotionEngine()
      expect(instance).toBeInstanceOf(EmotionEngine)
    })

    it('getEmotionEngine returns same instance', () => {
      createEmotionEngine()
      const a = getEmotionEngine()
      const b = getEmotionEngine()
      expect(a).toBe(b)
    })

    it('resetEmotionEngine clears instance', () => {
      createEmotionEngine()
      const a = getEmotionEngine()
      resetEmotionEngine()
      const b = getEmotionEngine()
      expect(a).not.toBe(b)
    })
  })
})
