import { describe, it, expect } from 'vitest'
import {
  createDefaultEmotionState,
  createDefaultPersonality,
  createDefaultEmotionConfig,
  emotionTypeToMood,
  emotionToVoiceModulation,
  emotionToTone,
  isPositiveEmotion,
  isNegativeEmotion,
} from '../../src/emotions.js'

describe('emotions utilities', () => {
  describe('createDefaultEmotionState', () => {
    it('returns neutral state', () => {
      const state = createDefaultEmotionState()
      expect(state.primary).toBe('neutral')
      expect(state.intensity).toBe(0.5)
      expect(state.mood).toBe('content')
      expect(state.triggers).toEqual([])
      expect(state.duration).toBe(0)
      expect(state.lastUpdated).toBeInstanceOf(Date)
    })
  })

  describe('createDefaultPersonality', () => {
    it('returns default personality profile', () => {
      const p = createDefaultPersonality()
      expect(p.dominantTrait).toBe('helpful')
      expect(p.warmthLevel).toBe(0.7)
      expect(p.humorLevel).toBe(0.5)
      expect(p.formalityLevel).toBe(0.4)
      expect(p.empathyLevel).toBe(0.8)
      expect(p.traits).toEqual(['helpful', 'warm', 'curious'])
    })
  })

  describe('createDefaultEmotionConfig', () => {
    it('returns config with defaults', () => {
      const config = createDefaultEmotionConfig()
      expect(config.defaultMood).toBe('content')
      expect(config.volatility).toBe(0.3)
      expect(config.empathyResponse).toBe(true)
      expect(config.personality).toBeTruthy()
    })
  })

  describe('emotionTypeToMood', () => {
    it('maps joy to happy', () => {
      expect(emotionTypeToMood('joy')).toBe('happy')
    })

    it('maps sadness to sad', () => {
      expect(emotionTypeToMood('sadness')).toBe('sad')
    })

    it('maps anger to angry', () => {
      expect(emotionTypeToMood('anger')).toBe('angry')
    })

    it('maps neutral to neutral', () => {
      expect(emotionTypeToMood('neutral')).toBe('neutral')
    })

    it('maps anticipation to excited', () => {
      expect(emotionTypeToMood('anticipation')).toBe('excited')
    })

    it('maps fear to worried', () => {
      expect(emotionTypeToMood('fear')).toBe('worried')
    })

    it('maps contempt to frustrated', () => {
      expect(emotionTypeToMood('contempt')).toBe('frustrated')
    })
  })

  describe('emotionToVoiceModulation', () => {
    it('returns higher pitch for joy', () => {
      const mod = emotionToVoiceModulation('joy', 0.9)
      expect(mod.pitch).toBeGreaterThan(1.0)
      expect(mod.emphasis).toBe('high')
    })

    it('returns lower pitch for sadness', () => {
      const mod = emotionToVoiceModulation('sadness', 0.5)
      expect(mod.pitch).toBeLessThan(1.0)
      expect(mod.speed).toBeLessThan(1.0)
    })

    it('sets emphasis based on intensity', () => {
      expect(emotionToVoiceModulation('neutral', 0.9).emphasis).toBe('high')
      expect(emotionToVoiceModulation('neutral', 0.6).emphasis).toBe('medium')
      expect(emotionToVoiceModulation('neutral', 0.3).emphasis).toBe('low')
    })
  })

  describe('emotionToTone', () => {
    it('maps joy to warm', () => {
      expect(emotionToTone('joy')).toBe('warm')
    })

    it('maps excitement to excited', () => {
      expect(emotionToTone('excitement')).toBe('excited')
    })

    it('maps contempt to cold', () => {
      expect(emotionToTone('contempt')).toBe('cold')
    })

    it('maps neutral to calm', () => {
      expect(emotionToTone('neutral')).toBe('calm')
    })

    it('maps unknown emotions to neutral', () => {
      expect(emotionToTone('frustration')).toBe('neutral')
    })
  })

  describe('isPositiveEmotion', () => {
    it('returns true for positive emotions', () => {
      expect(isPositiveEmotion('joy')).toBe(true)
      expect(isPositiveEmotion('love')).toBe(true)
      expect(isPositiveEmotion('trust')).toBe(true)
      expect(isPositiveEmotion('excitement')).toBe(true)
    })

    it('returns false for negative emotions', () => {
      expect(isPositiveEmotion('anger')).toBe(false)
      expect(isPositiveEmotion('sadness')).toBe(false)
    })
  })

  describe('isNegativeEmotion', () => {
    it('returns true for negative emotions', () => {
      expect(isNegativeEmotion('sadness')).toBe(true)
      expect(isNegativeEmotion('anger')).toBe(true)
      expect(isNegativeEmotion('fear')).toBe(true)
      expect(isNegativeEmotion('disgust')).toBe(true)
    })

    it('returns false for positive emotions', () => {
      expect(isNegativeEmotion('joy')).toBe(false)
      expect(isNegativeEmotion('love')).toBe(false)
    })
  })
})
