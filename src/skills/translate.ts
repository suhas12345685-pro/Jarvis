/**
 * Translation & NLP skills — translate text, detect language, analyze sentiment.
 * Uses the configured LLM for all NLP tasks (no external API required).
 */
import { registerSkill } from './index.js'
import type { AgentContext, SkillResult } from '../types/index.js'
import { getProvider } from '../llm/registry.js'
import { getByoakValue, loadConfig } from '../config.js'

async function llmCall(prompt: string, system: string): Promise<string> {
  const config = loadConfig()
  let apiKey = config.anthropicApiKey
  if (config.llmProvider !== 'anthropic') {
    apiKey = getByoakValue(config.byoak, config.llmProvider, 'API_KEY') || ''
  }
  const provider = getProvider({ provider: config.llmProvider, model: config.llmModel, apiKey })
  const response = await provider.chat({
    model: config.llmModel,
    system,
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 2048,
  })
  return response.text.trim()
}

registerSkill({
  name: 'translate_text',
  description: 'Translate text from one language to another using AI.',
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Text to translate' },
      from: { type: 'string', description: 'Source language (e.g., "English", "auto" for auto-detect). Default: auto' },
      to: { type: 'string', description: 'Target language (e.g., "Spanish", "Japanese", "French")' },
      tone: { type: 'string', description: 'Translation tone: formal, informal, technical. Default: neutral' },
    },
    required: ['text', 'to'],
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    try {
      const text = String(input.text)
      const from = String(input.from || 'auto-detect')
      const to = String(input.to)
      const tone = String(input.tone || 'neutral')

      const result = await llmCall(
        `Translate the following text from ${from} to ${to}. Tone: ${tone}.\n\nText:\n${text}`,
        'You are a professional translator. Return ONLY the translated text, nothing else. Preserve formatting, tone, and nuance.'
      )

      return { output: result, isError: false, metadata: { from, to, tone } }
    } catch (err) {
      return { output: `Translation error: ${(err as Error).message}`, isError: true }
    }
  },
})

registerSkill({
  name: 'detect_language',
  description: 'Detect the language of a given text.',
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Text to analyze' },
    },
    required: ['text'],
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    try {
      const text = String(input.text).slice(0, 1000)

      const result = await llmCall(
        `What language is this text written in? Text:\n"${text}"`,
        'You are a language detection system. Respond with ONLY a JSON object: {"language": "English", "code": "en", "confidence": "high|medium|low", "script": "Latin|Cyrillic|etc"}. Nothing else.'
      )

      // Try to parse JSON
      const jsonMatch = result.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        return { output: jsonMatch[0], isError: false }
      }

      return { output: result, isError: false }
    } catch (err) {
      return { output: `Language detection error: ${(err as Error).message}`, isError: true }
    }
  },
})

registerSkill({
  name: 'text_sentiment',
  description: 'Analyze the sentiment and emotional tone of text.',
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Text to analyze' },
      detailed: { type: 'boolean', description: 'Include detailed emotion breakdown (default: false)' },
    },
    required: ['text'],
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    try {
      const text = String(input.text).slice(0, 5000)
      const detailed = Boolean(input.detailed)

      const prompt = detailed
        ? `Analyze the sentiment and emotions in this text. Provide:\n1. Overall sentiment (positive/negative/neutral/mixed) with confidence score\n2. Primary emotions detected with intensity (0-1)\n3. Key phrases contributing to sentiment\n4. Brief explanation\n\nText:\n"${text}"`
        : `Analyze the sentiment of this text.\n\nText:\n"${text}"`

      const result = await llmCall(
        prompt,
        'You are a sentiment analysis system. Respond with ONLY a JSON object. For basic: {"sentiment": "positive|negative|neutral|mixed", "confidence": 0.0-1.0, "summary": "brief explanation"}. For detailed, add: "emotions": [{"emotion": "joy", "intensity": 0.8}], "key_phrases": ["phrase1"]'
      )

      const jsonMatch = result.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        return { output: jsonMatch[0], isError: false }
      }

      return { output: result, isError: false }
    } catch (err) {
      return { output: `Sentiment analysis error: ${(err as Error).message}`, isError: true }
    }
  },
})

registerSkill({
  name: 'text_entities',
  description: 'Extract named entities (people, places, organizations, dates, etc.) from text.',
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Text to analyze' },
      types: {
        type: 'array',
        items: { type: 'string' },
        description: 'Entity types to extract (e.g., ["person", "organization", "date", "location"]). Default: all',
      },
    },
    required: ['text'],
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    try {
      const text = String(input.text).slice(0, 5000)
      const types = input.types ? (input.types as string[]).join(', ') : 'all types'

      const result = await llmCall(
        `Extract named entities from this text. Entity types to find: ${types}.\n\nText:\n"${text}"`,
        'You are a named entity recognition system. Respond with ONLY a JSON object: {"entities": [{"text": "entity text", "type": "person|organization|location|date|money|percentage|product|event|other", "context": "surrounding text snippet"}]}. Nothing else.'
      )

      const jsonMatch = result.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        return { output: jsonMatch[0], isError: false }
      }

      return { output: result, isError: false }
    } catch (err) {
      return { output: `Entity extraction error: ${(err as Error).message}`, isError: true }
    }
  },
})
