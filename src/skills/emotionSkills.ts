import { registerSkill } from './index.js'
import type { AgentContext, SkillResult } from '../types/index.js'
import type { PersonalityTrait } from '../types/emotions.js'
import { getEmotionEngine } from '../emotionEngine.js'

registerSkill({
  name: 'detect_emotion',
  description: 'Analyze the emotional tone of a message. Returns sentiment (positive/negative/neutral), detected emotions with intensities, and overall confidence score.',
  inputSchema: {
    type: 'object',
    properties: {
      message: {
        type: 'string',
        description: 'The message to analyze emotionally',
      },
      userId: {
        type: 'string',
        description: 'User ID for tracking emotional history (optional)',
      },
    },
    required: ['message'],
  },
  handler: async (input: Record<string, unknown>, ctx: AgentContext): Promise<SkillResult> => {
    const emotionEngine = getEmotionEngine()
    const message = String(input.message)
    const userId = String(input.userId ?? ctx.userId)

    const sentiment = emotionEngine.analyzeSentiment(message)
    const emotion = emotionEngine.detectEmotion(message)
    const history = emotionEngine.getEmotionHistory(userId, 5)
    const summary = emotionEngine.getEmotionalSummary(userId)

    const result = {
      detectedEmotion: emotion,
      sentiment: sentiment.sentiment,
      sentimentScore: sentiment.score.toFixed(2),
      emotions: sentiment.emotions,
      confidence: sentiment.confidence.toFixed(2),
      currentMood: summary.currentEmotion.mood,
      personalityTraits: summary.personality.traits,
      recentTrend: summary.recentTrend,
    }

    return {
      output: `Emotional Analysis:\n- Primary Emotion: ${emotion}\n- Sentiment: ${sentiment.sentiment} (${sentiment.score.toFixed(2)})\n- Confidence: ${(sentiment.confidence * 100).toFixed(0)}%\n- User Mood: ${summary.currentEmotion.mood}\n- Recent Trend: ${summary.recentTrend ?? 'insufficient data'}`,
      isError: false,
    }
  },
})

registerSkill({
  name: 'set_personality',
  description: 'Set or update the personality traits for a user. Affects how JARVIS responds emotionally.',
  inputSchema: {
    type: 'object',
    properties: {
      warmthLevel: {
        type: 'number',
        description: 'Warmth level 0-1 (higher = more empathetic responses)',
      },
      humorLevel: {
        type: 'number',
        description: 'Humor level 0-1 (higher = more playful)',
      },
      formalityLevel: {
        type: 'number',
        description: 'Formality level 0-1 (higher = more formal)',
      },
      empathyLevel: {
        type: 'number',
        description: 'Empathy level 0-1 (higher = more understanding)',
      },
      traits: {
        type: 'array',
        items: { type: 'string' },
        description: 'Personality traits (helpful, playful, warm, professional, curious, witty)',
      },
    },
  },
  handler: async (input: Record<string, unknown>, ctx: AgentContext): Promise<SkillResult> => {
    const emotionEngine = getEmotionEngine()

    const warmthLevel = Number(input.warmthLevel ?? 0.7)
    const humorLevel = Number(input.humorLevel ?? 0.5)
    const formalityLevel = Number(input.formalityLevel ?? 0.4)
    const empathyLevel = Number(input.empathyLevel ?? 0.8)
    const traits = ((input.traits as string[]) ?? ['helpful', 'warm', 'curious']) as PersonalityTrait[]

    const personality = {
      traits,
      dominantTrait: traits[0] as 'helpful' | 'playful' | 'warm' | 'professional' | 'curious' | 'witty',
      warmthLevel,
      humorLevel,
      formalityLevel,
      empathyLevel,
    }

    emotionEngine.setPersonality(ctx.userId, personality)

    return {
      output: `Personality updated for user ${ctx.userId}:\n- Traits: ${traits.join(', ')}\n- Warmth: ${(warmthLevel * 100).toFixed(0)}%\n- Humor: ${(humorLevel * 100).toFixed(0)}%\n- Formality: ${(formalityLevel * 100).toFixed(0)}%\n- Empathy: ${(empathyLevel * 100).toFixed(0)}%`,
      isError: false,
    }
  },
})

registerSkill({
  name: 'get_emotional_state',
  description: 'Get the current emotional state, mood, and personality profile for a user.',
  inputSchema: {
    type: 'object',
    properties: {
      userId: {
        type: 'string',
        description: 'User ID to query (defaults to current user)',
      },
    },
  },
  handler: async (_input: Record<string, unknown>, ctx: AgentContext): Promise<SkillResult> => {
    const emotionEngine = getEmotionEngine()
    const summary = emotionEngine.getEmotionalSummary(ctx.userId)

    return {
      output: `Emotional State for ${ctx.userId}:\n\nCurrent Emotion: ${summary.currentEmotion.primary}\n- Intensity: ${(summary.currentEmotion.intensity * 100).toFixed(0)}%\n- Mood: ${summary.currentEmotion.mood}\n- Triggers: ${summary.currentEmotion.triggers.join(', ') || 'none'}\n\nPersonality:\n- Traits: ${summary.personality.traits.join(', ')}\n- Dominant: ${summary.personality.dominantTrait}\n- Warmth: ${(summary.personality.warmthLevel * 100).toFixed(0)}%\n- Humor: ${(summary.personality.humorLevel * 100).toFixed(0)}%\n- Formality: ${(summary.personality.formalityLevel * 100).toFixed(0)}%\n\nRecent Trend: ${summary.recentTrend ?? 'insufficient data'}`,
      isError: false,
    }
  },
})
