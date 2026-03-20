export type {
  EmotionType,
  MoodState,
  PersonalityTrait,
  EmotionState,
  PersonalityProfile,
  EmotionConfig,
  SentimentResult,
  EmotionalResponse,
  VoiceModulation,
} from './types/emotions.js'

import type {
  EmotionType,
  MoodState,
  EmotionState,
  PersonalityProfile,
  EmotionConfig,
  EmotionalResponse,
  VoiceModulation,
} from './types/emotions.js'

export function createDefaultEmotionState(): EmotionState {
  return {
    primary: 'neutral',
    secondary: undefined,
    intensity: 0.5,
    mood: 'content',
    triggers: [],
    duration: 0,
    lastUpdated: new Date(),
  }
}

export function createDefaultPersonality(): PersonalityProfile {
  return {
    traits: ['helpful', 'warm', 'curious'],
    dominantTrait: 'helpful',
    warmthLevel: 0.7,
    humorLevel: 0.5,
    formalityLevel: 0.4,
    empathyLevel: 0.8,
  }
}

export function createDefaultEmotionConfig(): EmotionConfig {
  return {
    defaultMood: 'content',
    personality: createDefaultPersonality(),
    volatility: 0.3,
    empathyResponse: true,
  }
}

export function emotionTypeToMood(type: EmotionType): MoodState {
  const mapping: Record<EmotionType, MoodState> = {
    joy: 'happy',
    love: 'happy',
    serenity: 'content',
    admiration: 'content',
    trust: 'content',
    anticipation: 'excited',
    excitement: 'excited',
    surprise: 'pensive',
    neutral: 'neutral',
    boredom: 'pensive',
    sadness: 'sad',
    remorse: 'sad',
    fear: 'worried',
    vigilance: 'worried',
    anger: 'angry',
    contempt: 'frustrated',
    disgust: 'frustrated',
    frustration: 'frustrated',
    amazement: 'excited',
    curiosity: 'pensive',
    gratitude: 'happy',
  }
  return mapping[type] ?? 'neutral'
}

export function emotionToVoiceModulation(
  emotion: EmotionType,
  intensity: number
): VoiceModulation {
  const baseSpeed = 1.0
  const basePitch = 1.0
  const baseVolume = 1.0

  const modulations: Record<EmotionType, Omit<VoiceModulation, 'emphasis'>> = {
    joy: { pitch: basePitch * 1.1, speed: baseSpeed * 1.1, volume: baseVolume * 1.05 },
    excitement: { pitch: basePitch * 1.15, speed: baseSpeed * 1.2, volume: baseVolume * 1.1 },
    anger: { pitch: basePitch * 0.9, speed: baseSpeed * 1.15, volume: baseVolume * 1.1 },
    fear: { pitch: basePitch * 1.2, speed: baseSpeed * 1.1, volume: baseVolume * 0.95 },
    sadness: { pitch: basePitch * 0.85, speed: baseSpeed * 0.9, volume: baseVolume * 0.9 },
    love: { pitch: basePitch * 1.05, speed: baseSpeed * 0.95, volume: baseVolume * 1.0 },
    surprise: { pitch: basePitch * 1.1, speed: baseSpeed * 1.15, volume: baseVolume * 1.05 },
    trust: { pitch: basePitch * 1.0, speed: baseSpeed * 0.95, volume: baseVolume * 1.0 },
    anticipation: { pitch: basePitch * 1.08, speed: baseSpeed * 1.05, volume: baseVolume * 1.0 },
    serenity: { pitch: basePitch * 1.0, speed: baseSpeed * 0.9, volume: baseVolume * 0.95 },
    admiration: { pitch: basePitch * 1.02, speed: baseSpeed * 0.95, volume: baseVolume * 1.0 },
    curiosity: { pitch: basePitch * 1.05, speed: baseSpeed * 1.05, volume: baseVolume * 1.0 },
    neutral: { pitch: basePitch, speed: baseSpeed, volume: baseVolume },
    boredom: { pitch: basePitch * 0.95, speed: baseSpeed * 0.85, volume: baseVolume * 0.9 },
    disgust: { pitch: basePitch * 0.9, speed: baseSpeed * 1.0, volume: baseVolume * 1.0 },
    contempt: { pitch: basePitch * 0.9, speed: baseSpeed * 0.95, volume: baseVolume * 1.0 },
    remorse: { pitch: basePitch * 0.9, speed: baseSpeed * 0.9, volume: baseVolume * 0.9 },
    vigilance: { pitch: basePitch * 1.05, speed: baseSpeed * 1.0, volume: baseVolume * 1.0 },
    amazement: { pitch: basePitch * 1.1, speed: baseSpeed * 1.15, volume: baseVolume * 1.05 },
    frustration: { pitch: basePitch * 0.85, speed: baseSpeed * 1.1, volume: baseVolume * 1.05 },
    gratitude: { pitch: basePitch * 1.02, speed: baseSpeed * 0.95, volume: baseVolume * 1.0 },
  }

  const mod = modulations[emotion] ?? modulations.neutral

  const emphasis: VoiceModulation['emphasis'] =
    intensity > 0.8 ? 'high' : intensity > 0.5 ? 'medium' : 'low'

  return {
    ...mod,
    emphasis,
  }
}

export function emotionToTone(
  emotion: EmotionType
): EmotionalResponse['tone'] {
  const warmTones: EmotionType[] = ['joy', 'love', 'trust', 'serenity', 'admiration']
  const excitedTones: EmotionType[] = ['excitement', 'anticipation', 'surprise']
  const calmTones: EmotionType[] = ['neutral', 'boredom', 'remorse']
  const coldTones: EmotionType[] = ['contempt', 'disgust']

  if (warmTones.includes(emotion)) return 'warm'
  if (excitedTones.includes(emotion)) return 'excited'
  if (coldTones.includes(emotion)) return 'cold'
  if (calmTones.includes(emotion)) return 'calm'
  return 'neutral'
}

export function isPositiveEmotion(emotion: EmotionType): boolean {
  return ['joy', 'love', 'trust', 'serenity', 'admiration', 'anticipation', 'excitement'].includes(emotion)
}

export function isNegativeEmotion(emotion: EmotionType): boolean {
  return ['sadness', 'anger', 'fear', 'disgust', 'remorse', 'contempt'].includes(emotion)
}
