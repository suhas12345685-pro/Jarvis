export type EmotionType =
  | 'joy' | 'sadness' | 'anger' | 'fear' | 'surprise'
  | 'disgust' | 'trust' | 'anticipation' | 'love' | 'remorse'
  | 'contempt' | 'admiration' | 'serenity' | 'amazement' | 'vigilance'
  | 'boredom' | 'neutral' | 'excitement' | 'frustration' | 'curiosity'
  | 'gratitude'

export type MoodState =
  | 'excited' | 'happy' | 'content' | 'neutral' | 'pensive'
  | 'worried' | 'sad' | 'frustrated' | 'angry' | 'overwhelmed'

export type PersonalityTrait =
  | 'helpful' | 'playful' | 'sarcastic' | 'warm' | 'professional'
  | 'curious' | 'cautious' | 'witty' | 'empathetic' | 'direct'

export interface EmotionState {
  primary: EmotionType
  secondary?: EmotionType
  intensity: number
  mood: MoodState
  triggers: string[]
  duration: number
  lastUpdated: Date
}

export interface PersonalityProfile {
  traits: PersonalityTrait[]
  dominantTrait: PersonalityTrait
  warmthLevel: number
  humorLevel: number
  formalityLevel: number
  empathyLevel: number
}

export interface EmotionMemory {
  id: string
  content: string
  emotion: EmotionType
  intensity: number
  userId: string
  timestamp: Date
  context: string
}

export interface EmotionConfig {
  defaultMood: MoodState
  personality: PersonalityProfile
  volatility: number
  empathyResponse: boolean
}

export interface SentimentResult {
  sentiment: 'positive' | 'negative' | 'neutral'
  score: number
  emotions: Array<{ type: EmotionType; intensity: number }>
  confidence: number
}

export interface EmotionalResponse {
  emotion: EmotionState
  response: string
  tone: 'warm' | 'neutral' | 'cold' | 'excited' | 'calm'
  shouldShowEmotion: boolean
  voiceModulation?: VoiceModulation
}

export interface VoiceModulation {
  pitch: number
  speed: number
  volume: number
  emphasis: 'high' | 'medium' | 'low'
}
