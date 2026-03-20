import { describe, it, expect, beforeEach } from 'vitest'
import {
  EmotionEngine,
  createEmotionEngine,
  getEmotionEngine,
  resetEmotionEngine,
} from '../src/emotionEngine.js'
import {
  createDefaultEmotionState,
  createDefaultPersonality,
  emotionToVoiceModulation,
  emotionToTone,
  isPositiveEmotion,
  isNegativeEmotion,
} from '../src/types/emotions.js'

describe('Emotion System', () => {
  beforeEach(() => {
    resetEmotionEngine()
  })

  describe('EmotionEngine', () => {
    it('should create default emotion state', () => {
      const engine = createEmotionEngine()
      const state = engine.getOrCreateState('user-1')
      
      expect(state.primary).toBe('neutral')
      expect(state.mood).toBe('content')
      expect(state.intensity).toBe(0.5)
    })

    it('should detect positive sentiment', () => {
      const engine = createEmotionEngine()
      const result = engine.analyzeSentiment('This is great! I love it so much!')
      
      expect(result.sentiment).toBe('positive')
      expect(result.score).toBeGreaterThan(0)
    })

    it('should detect negative sentiment', () => {
      const engine = createEmotionEngine()
      const result = engine.analyzeSentiment('This is terrible and awful. I hate it.')
      
      expect(result.sentiment).toBe('negative')
      expect(result.score).toBeLessThan(0)
    })

    it('should detect joy emotion', () => {
      const engine = createEmotionEngine()
      const emotion = engine.detectEmotion('This is amazing! I am so happy!')
      
      expect(emotion).toBe('joy')
    })

    it('should detect sadness emotion', () => {
      const engine = createEmotionEngine()
      const emotion = engine.detectEmotion('I feel so sad today')
      
      expect(emotion).toBe('sadness')
    })

    it('should detect anger emotion', () => {
      const engine = createEmotionEngine()
      const emotion = engine.detectEmotion('This is so frustrating! I am angry!')
      
      expect(emotion).toBe('anger')
    })

    it('should update emotion based on user message', () => {
      const engine = createEmotionEngine()
      const state = engine.updateEmotion('user-1', 'I am so excited about this!')
      
      expect(state.primary).toBe('anticipation')
      expect(state.mood).toBe('excited')
    })

    it('should generate empathetic responses', () => {
      const engine = createEmotionEngine()
      engine.updateEmotion('user-1', 'I am feeling sad')
      
      const result = engine.generateEmpatheticResponse('user-1', 'I understand', 'sadness')
      
      expect(result.response).toContain('understand')
      expect(result.tone).toBe('warm')
      expect(result.voiceModulation).toBeDefined()
    })

    it('should track emotion history', () => {
      const engine = createEmotionEngine()
      engine.updateEmotion('user-1', 'This is great!')
      engine.updateEmotion('user-1', 'I am happy!')
      
      const history = engine.getEmotionHistory('user-1')
      
      expect(history.length).toBe(2)
    })

    it('should set personality profile', () => {
      const engine = createEmotionEngine()
      engine.setPersonality('user-1', {
        traits: ['helpful', 'playful'],
        dominantTrait: 'playful',
        warmthLevel: 0.9,
        humorLevel: 0.8,
        formalityLevel: 0.2,
        empathyLevel: 0.9,
      })
      
      const personality = engine.getPersonality('user-1')
      
      expect(personality.traits).toContain('playful')
      expect(personality.warmthLevel).toBe(0.9)
    })

    it('should get emotional summary', () => {
      const engine = createEmotionEngine()
      engine.updateEmotion('user-1', 'I love this!')
      
      const summary = engine.getEmotionalSummary('user-1')
      
      expect(summary.currentEmotion).toBeDefined()
      expect(summary.personality).toBeDefined()
    })
  })

  describe('Emotion Utilities', () => {
    it('should create default emotion state', () => {
      const state = createDefaultEmotionState()
      
      expect(state.primary).toBe('neutral')
      expect(state.intensity).toBe(0.5)
      expect(state.mood).toBe('content')
    })

    it('should create default personality', () => {
      const personality = createDefaultPersonality()
      
      expect(personality.traits).toContain('helpful')
      expect(personality.warmthLevel).toBe(0.7)
    })

    it('should map emotions to voice modulation', () => {
      const mod = emotionToVoiceModulation('joy', 0.8)
      
      expect(mod.pitch).toBeGreaterThan(1)
      expect(mod.speed).toBeGreaterThan(1)
      expect(mod.emphasis).toBe('medium')
    })

    it('should map emotions to tone', () => {
      expect(emotionToTone('joy')).toBe('warm')
      expect(emotionToTone('anger')).toBe('cold')
      expect(emotionToTone('excitement')).toBe('excited')
    })

    it('should identify positive emotions', () => {
      expect(isPositiveEmotion('joy')).toBe(true)
      expect(isPositiveEmotion('love')).toBe(true)
      expect(isPositiveEmotion('sadness')).toBe(false)
    })

    it('should identify negative emotions', () => {
      expect(isNegativeEmotion('sadness')).toBe(true)
      expect(isNegativeEmotion('anger')).toBe(true)
      expect(isNegativeEmotion('joy')).toBe(false)
    })
  })

  describe('Emotion Decay', () => {
    it('should decay emotions over time', async () => {
      const engine = createEmotionEngine()
      engine.updateEmotion('user-1', 'This is great!')
      
      const beforeDecay = engine.getOrCreateState('user-1').intensity
      
      await new Promise(resolve => setTimeout(resolve, 100))
      engine.decayEmotions()
      
      const afterDecay = engine.getOrCreateState('user-1').intensity
      
      expect(afterDecay).toBeLessThanOrEqual(beforeDecay)
    })
  })

  describe('Personality Calibration', () => {
    it('should calibrate personality from interaction', () => {
      const engine = createEmotionEngine()
      
      engine.calibratePersonalityFromInteraction('user-1', 'Thanks for helping!', 'You are welcome!')
      
      const personality = engine.getPersonality('user-1')
      expect(personality.traits).toContain('helpful')
    })
  })
})
