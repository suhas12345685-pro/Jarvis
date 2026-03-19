import type {
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
import {
  createDefaultEmotionState,
  createDefaultPersonality,
  createDefaultEmotionConfig,
  emotionToVoiceModulation,
  emotionToTone,
  isPositiveEmotion,
  isNegativeEmotion,
} from './types/emotions.js'
import { getLogger } from './logger.js'
import { randomUUID } from 'crypto'

interface EmotionTrigger {
  pattern: RegExp
  emotion: EmotionType
  intensity: number
  mood?: MoodState
}

const POSITIVE_WORDS = new Set([
  'great', 'amazing', 'wonderful', 'fantastic', 'excellent', 'love', 'happy',
  'joy', 'beautiful', 'awesome', 'brilliant', 'perfect', 'good', 'nice',
  'thank', 'thanks', 'appreciate', 'helpful', 'excited', 'thrilled', 'glad',
  'pleased', 'delighted', 'grateful', 'fantastic', 'superb', 'outstanding',
])

const NEGATIVE_WORDS = new Set([
  'bad', 'terrible', 'awful', 'horrible', 'hate', 'angry', 'sad', 'worst',
  'stupid', 'dumb', 'annoying', 'frustrating', 'disappointing', 'upset',
  'sucks', 'fail', 'failed', 'error', 'problem', 'issue', 'broken', 'bug',
  'difficult', 'hard', 'confusing', 'worry', 'fear', 'scared', 'nervous',
])

const EXCLAMATION_PATTERNS = [
  /\!{2,}/,
  /\?{2,}/,
  /\.\.\./,
  /\bwow\b/i,
  /\bomg\b/i,
  /\bwtf\b/i,
  /\blol\b/i,
  /\brofl\b/i,
]

const SARCASM_PATTERNS = [
  /\bnot\s+(?:bad|good|great|terrible|awful)/i,
  /\byeah\s+right\b/i,
  /\bsure\s+(?:buddy|sure)\b/i,
  /\bwhatever\b/i,
  /\bokay\s+sure\b/i,
  /\/s$/i,
]

const GRATITUDE_PATTERNS = [
  /\bthank\s+you\b/i,
  /\bthanks\b/i,
  /\bappreciate\b/i,
  /\bgrateful\b/i,
  /\bthank\s+you\s+so\s+much\b/i,
]

const QUESTION_PATTERNS = [
  /\?$/,
  /\bhow\b.*\?/i,
  /\bwhat\b.*\?/i,
  /\bwhy\b.*\?/i,
  /\bwhen\b.*\?/i,
  /\bcan\s+you\b.*\?/i,
  /\bcould\s+you\b.*\?/i,
  /\bwould\s+you\b.*\?/i,
]

const TRIGGERS: EmotionTrigger[] = [
  { pattern: /\b(great|amazing|wonderful|fantastic)\b/i, emotion: 'joy', intensity: 0.9 },
  { pattern: /\b(love|loving|loved)\b/i, emotion: 'love', intensity: 0.85 },
  { pattern: /\b(thank|thanks|appreciate)\b/i, emotion: 'trust', intensity: 0.7, mood: 'content' },
  { pattern: /\b(angry|anger|mad|furious)\b/i, emotion: 'anger', intensity: 0.85 },
  { pattern: /\b(sad|sadness|depressed|unhappy)\b/i, emotion: 'sadness', intensity: 0.8 },
  { pattern: /\b(afraid|fear|scary|terrified)\b/i, emotion: 'fear', intensity: 0.75 },
  { pattern: /\b(excited|thrilled|can\'t wait)\b/i, emotion: 'anticipation', intensity: 0.8, mood: 'excited' },
  { pattern: /\b(sorry|apologize|apologise)\b/i, emotion: 'remorse', intensity: 0.7 },
  { pattern: /\b(help|assist|need)\b/i, emotion: 'trust', intensity: 0.6 },
  { pattern: /\b(interesting|curious|wondering)\b/i, emotion: 'anticipation', intensity: 0.6 },
  { pattern: /\b(beautiful|gorgeous|stunning)\b/i, emotion: 'admiration', intensity: 0.8 },
  { pattern: /\b(disgusting|gross|eww|yuck)\b/i, emotion: 'disgust', intensity: 0.75 },
  { pattern: /\b(awesome|cool|impressive)\b/i, emotion: 'joy', intensity: 0.75 },
  { pattern: /\b(congratulations|congrats|well done)\b/i, emotion: 'joy', intensity: 0.85 },
  { pattern: /\b(workout|exercise|gym|run)\b/i, emotion: 'anticipation', intensity: 0.5 },
  { pattern: /\b(money|cash|pay|payment)\b/i, emotion: 'vigilance', intensity: 0.6 },
]

export class EmotionEngine {
  private userStates: Map<string, EmotionState> = new Map()
  private personalityCache: Map<string, PersonalityProfile> = new Map()
  private emotionHistory: Map<string, Array<{ emotion: EmotionType; timestamp: Date }>> = new Map()
  private config: EmotionConfig
  private logger = getLogger()

  constructor(config?: Partial<EmotionConfig>) {
    this.config = {
      ...createDefaultEmotionConfig(),
      ...config,
    }
  }

  getOrCreateState(userId: string): EmotionState {
    if (!this.userStates.has(userId)) {
      this.userStates.set(userId, createDefaultEmotionState())
    }
    return this.userStates.get(userId)!
  }

  getPersonality(userId: string): PersonalityProfile {
    if (!this.personalityCache.has(userId)) {
      this.personalityCache.set(userId, createDefaultPersonality())
    }
    return this.personalityCache.get(userId)!
  }

  setPersonality(userId: string, personality: PersonalityProfile): void {
    this.personalityCache.set(userId, personality)
    const state = this.getOrCreateState(userId)
    state.primary = personality.dominantTrait === 'empathetic' ? 'trust' : 'neutral'
    state.lastUpdated = new Date()
  }

  analyzeSentiment(text: string): SentimentResult {
    const words = text.toLowerCase().split(/\s+/)
    let positiveCount = 0
    let negativeCount = 0
    const detectedEmotions: Array<{ type: EmotionType; intensity: number }> = []

    for (const word of words) {
      const cleanWord = word.replace(/[^\w]/g, '')
      if (POSITIVE_WORDS.has(cleanWord)) positiveCount++
      if (NEGATIVE_WORDS.has(cleanWord)) negativeCount++
    }

    for (const trigger of TRIGGERS) {
      if (trigger.pattern.test(text)) {
        detectedEmotions.push({
          type: trigger.emotion,
          intensity: trigger.intensity,
        })
      }
    }

    const exclamationCount = EXCLAMATION_PATTERNS.reduce(
      (count, pattern) => count + (pattern.test(text) ? 1 : 0),
      0
    )

    const sarcasmDetected = SARCASM_PATTERNS.some(p => p.test(text))
    const gratitudeDetected = GRATITUDE_PATTERNS.some(p => p.test(text))
    const questionDetected = QUESTION_PATTERNS.some(p => p.test(text))

    if (sarcasmDetected) {
      detectedEmotions.push({ type: 'contempt', intensity: 0.7 })
    }

    if (gratitudeDetected) {
      detectedEmotions.push({ type: 'trust', intensity: 0.8 })
    }

    if (questionDetected && detectedEmotions.length === 0) {
      detectedEmotions.push({ type: 'neutral', intensity: 0.5 })
    }

    const rawScore = (positiveCount - negativeCount) / Math.max(words.length, 1)
    const normalizedScore = Math.max(-1, Math.min(1, rawScore * 2 + (exclamationCount > 0 ? 0.2 : 0)))

    const sentiment: SentimentResult['sentiment'] =
      normalizedScore > 0.1 ? 'positive' :
      normalizedScore < -0.1 ? 'negative' : 'neutral'

    const emotionCounts = new Map<EmotionType, number>()
    for (const { type } of detectedEmotions) {
      emotionCounts.set(type, (emotionCounts.get(type) ?? 0) + 1)
    }

    let topEmotion: EmotionType = 'neutral'
    let topCount = 0
    for (const [type, count] of emotionCounts) {
      if (count > topCount) {
        topCount = count
        topEmotion = type
      }
    }

    const confidence = Math.min(1, detectedEmotions.length * 0.2 + Math.abs(normalizedScore) * 0.5)

    return {
      sentiment,
      score: normalizedScore,
      emotions: detectedEmotions,
      confidence,
    }
  }

  detectEmotion(text: string): EmotionType {
    const { emotions } = this.analyzeSentiment(text)
    if (emotions.length === 0) return 'neutral'
    return emotions[0].type
  }

  updateEmotion(userId: string, text: string): EmotionState {
    const state = this.getOrCreateState(userId)
    const { emotions, sentiment, score } = this.analyzeSentiment(text)

    const now = Date.now()
    const timeSinceLastUpdate = now - state.lastUpdated.getTime()

    if (emotions.length > 0) {
      const topEmotion = emotions.reduce((prev, curr) =>
        curr.intensity > prev.intensity ? curr : prev
      )

      const emotionDecay = Math.max(0, state.intensity - (timeSinceLastUpdate / 60000) * 0.1)
      const newIntensity = Math.min(1, Math.max(0.1, topEmotion.intensity + emotionDecay) * 0.5)

      const volatilityFactor = this.config.volatility
      const updatedIntensity =
        state.intensity * (1 - volatilityFactor) + newIntensity * volatilityFactor

      state.primary = topEmotion.type
      state.intensity = updatedIntensity
      state.lastUpdated = new Date()
      state.duration = timeSinceLastUpdate

      const matchedTrigger = TRIGGERS.find(t => t.pattern.test(text))
      if (matchedTrigger?.mood) {
        state.mood = matchedTrigger.mood
      }

      this.recordEmotionHistory(userId, topEmotion.type)
    }

    if (sentiment === 'positive' && isPositiveEmotion(state.primary)) {
      state.intensity = Math.min(1, state.intensity + score * 0.1)
    } else if (sentiment === 'negative' && isNegativeEmotion(state.primary)) {
      state.intensity = Math.min(1, state.intensity + Math.abs(score) * 0.1)
    }

    this.logger.debug('Emotion updated', {
      userId,
      emotion: state.primary,
      intensity: state.intensity,
      mood: state.mood,
    })

    return { ...state }
  }

  private recordEmotionHistory(userId: string, emotion: EmotionType): void {
    if (!this.emotionHistory.has(userId)) {
      this.emotionHistory.set(userId, [])
    }
    const history = this.emotionHistory.get(userId)!
    history.push({ emotion, timestamp: new Date() })

    if (history.length > 100) {
      history.shift()
    }
  }

  getEmotionHistory(userId: string, limit = 10): Array<{ emotion: EmotionType; timestamp: Date }> {
    const history = this.emotionHistory.get(userId) ?? []
    return history.slice(-limit)
  }

  getDominantEmotionTrend(userId: string, windowMinutes = 30): EmotionType | null {
    const history = this.emotionHistory.get(userId) ?? []
    const cutoff = Date.now() - windowMinutes * 60 * 1000
    const recent = history.filter(h => h.timestamp.getTime() > cutoff)

    if (recent.length === 0) return null

    const counts = new Map<EmotionType, number>()
    for (const { emotion } of recent) {
      counts.set(emotion, (counts.get(emotion) ?? 0) + 1)
    }

    let dominant: EmotionType | null = null
    let maxCount = 0
    for (const [emotion, count] of counts) {
      if (count > maxCount) {
        maxCount = count
        dominant = emotion
      }
    }

    return dominant
  }

  generateEmpatheticResponse(
    userId: string,
    baseResponse: string,
    emotion: EmotionType
  ): EmotionalResponse {
    const state = this.getOrCreateState(userId)
    const personality = this.getPersonality(userId)

    const prefixEmotions: Record<EmotionType, string[]> = {
      joy: ['Wonderful! ', 'That\'s great to hear! ', 'I\'m so happy for you! '],
      sadness: ['I understand this is tough. ', 'I\'m here to help. ', 'Let\'s work through this together. '],
      anger: ['I can see this is frustrating. ', 'Let\'s take a calm approach. ', 'I\'m here to help sort this out. '],
      fear: ['Don\'t worry, we\'ll figure this out. ', 'I\'m here to help. ', 'Let me assist you. '],
      trust: ['You\'re welcome! ', 'Happy to help! ', 'Glad I could assist! '],
      anticipation: ['Exciting! ', 'Looking forward to it! ', 'Let\'s get started! '],
      gratitude: ['You\'re welcome! ', 'My pleasure! ', 'Always happy to help! '],
      neutral: ['', '', ''],
      surprise: ['That\'s interesting! ', 'Wow, that\'s surprising! ', 'I didn\'t see that coming! '],
      disgust: ['That does sound unpleasant. ', 'I understand your frustration. ', 'Let\'s focus on solutions. '],
      contempt: ['I hear you. ', 'Let\'s try a different approach. ', 'How about we tackle this differently? '],
      love: ['That\'s so kind! ', 'Aw, thank you! ', 'I appreciate that! '],
      admiration: ['Thanks! ', 'I\'m glad you think so! ', 'That means a lot! '],
      serenity: ['Indeed. ', 'That sounds peaceful. ', 'Lovely! '],
      amazement: ['That\'s incredible! ', 'Wow! ', 'Amazing! '],
      vigilance: ['Good point. ', 'I\'ll keep that in mind. ', 'Let\'s be careful about that. '],
      boredom: ['Let me find something more engaging for you. ', 'How about we try something new? ', 'I can help with that! '],
      remorse: ['It\'s okay, mistakes happen. ', 'No worries! ', 'Let\'s learn from this. '],
    }

    const suffixes: Record<EmotionType, string[]> = {
      joy: [' 😊', '', ' 🎉'],
      sadness: [' 💙', '', ' 🤗'],
      anger: [' 😤', '', ' 🙏'],
      fear: [' 🤝', '', ' 💪'],
      trust: [' 🙌', '', ''],
      anticipation: [' 🚀', '', ' ✨'],
      gratitude: [' 💛', '', ''],
      neutral: ['', '', ''],
      surprise: [' 😮', '', ''],
      disgust: [' 🤢', '', ''],
      contempt: [' 🙄', '', ''],
      love: [' 💕', '', ' ❤️'],
      admiration: [' ⭐', '', ''],
      serenity: [' 😌', '', ''],
      amazement: [' 🤩', '', ' ✨'],
      vigilance: [' 👀', '', ''],
      boredom: [' 🤔', '', ' 💡'],
      remorse: [' 😔', '', ' 🤗'],
    }

    let response = baseResponse
    const empathyEnabled = this.config.empathyResponse
    const warmPersonality = personality.warmthLevel > 0.6

    if (empathyEnabled && emotion !== 'neutral' && baseResponse.length > 0) {
      const prefixes = prefixEmotions[emotion] ?? prefixEmotions.neutral
      const prefix = prefixes[Math.floor(Math.random() * prefixes.length)]

      const suffixes_list = suffixes[emotion] ?? suffixes.neutral
      const suffix = warmPersonality ? suffixes_list[Math.floor(Math.random() * suffixes_list.length)] : ''

      if (prefix && !baseResponse.toLowerCase().startsWith(prefix.toLowerCase().trim())) {
        response = prefix + response.charAt(0).toUpperCase() + response.slice(1)
      }

      if (suffix && !response.endsWith(suffix)) {
        response = response.trimEnd() + suffix
      }
    }

    const voiceModulation = emotionToVoiceModulation(emotion, state.intensity)
    const tone = emotionToTone(emotion)

    const shouldShowEmotion =
      empathyEnabled &&
      (isPositiveEmotion(emotion) || isNegativeEmotion(emotion)) &&
      personality.warmthLevel > 0.4

    return {
      emotion: { ...state },
      response,
      tone,
      shouldShowEmotion,
      voiceModulation,
    }
  }

  calibratePersonalityFromInteraction(
    userId: string,
    message: string,
    response: string
  ): void {
    const personality = this.getPersonality(userId)

    if (message.includes('?') && !response.includes('?')) {
      if (!personality.traits.includes('helpful')) {
        personality.traits.push('helpful')
      }
    }

    if (/!\?/.test(message) || /\.\.\./.test(message)) {
      personality.humorLevel = Math.min(1, personality.humorLevel + 0.1)
    }

    if (/^yo|^hey|^hi|^hello/i.test(message)) {
      personality.formalityLevel = Math.max(0, personality.formalityLevel - 0.1)
    }

    if (message.toLowerCase().includes('sorry') || message.toLowerCase().includes('apologize')) {
      personality.empathyLevel = Math.min(1, personality.empathyLevel + 0.1)
    }

    if (personality.traits.length > 5) {
      personality.traits = personality.traits.slice(-5)
    }

    const dominantTrait = personality.traits.reduce((prev, curr) =>
      personality.traits.indexOf(curr) % 2 === 0 ? prev : curr,
      personality.traits[0]
    )
    personality.dominantTrait = dominantTrait ?? 'helpful'

    this.personalityCache.set(userId, personality)
  }

  decayEmotions(): void {
    const now = Date.now()
    for (const [userId, state] of this.userStates.entries()) {
      const elapsed = now - state.lastUpdated.getTime()
      const decayRate = 0.05

      if (elapsed > 60000) {
        state.intensity = Math.max(0.1, state.intensity - decayRate)
        state.lastUpdated = new Date()

        if (state.intensity <= 0.2) {
          state.primary = 'neutral'
          state.mood = 'content'
        }
      }
    }
  }

  getEmotionalSummary(userId: string): {
    currentEmotion: EmotionState
    personality: PersonalityProfile
    recentTrend: EmotionType | null
  } {
    return {
      currentEmotion: this.getOrCreateState(userId),
      personality: this.getPersonality(userId),
      recentTrend: this.getDominantEmotionTrend(userId),
    }
  }
}

let emotionEngineInstance: EmotionEngine | null = null

export function createEmotionEngine(config?: Partial<EmotionConfig>): EmotionEngine {
  emotionEngineInstance = new EmotionEngine(config)
  return emotionEngineInstance
}

export function getEmotionEngine(): EmotionEngine {
  if (!emotionEngineInstance) {
    emotionEngineInstance = new EmotionEngine()
  }
  return emotionEngineInstance
}

export function resetEmotionEngine(): void {
  emotionEngineInstance = null
}
