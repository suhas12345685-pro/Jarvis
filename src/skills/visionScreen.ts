import { registerSkill } from './index.js'
import type { AgentContext, SkillResult } from '../types/index.js'
import { getByoakValue } from '../config.js'

registerSkill({
  name: 'vision_screen',
  description: 'Silently capture a screenshot of the current desktop and analyze what is visible on screen using Claude Vision.',
  inputSchema: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description: 'What to look for or analyze in the screenshot (e.g., "What application is open?", "What does the error message say?")',
      },
    },
    required: ['question'],
  },
  handler: async (input: Record<string, unknown>, ctx: AgentContext): Promise<SkillResult> => {
    try {
      const screenshot = await import('screenshot-desktop')
      const imgBuffer: Buffer = await screenshot.default()
      const base64 = imgBuffer.toString('base64')

      const Anthropic = (await import('@anthropic-ai/sdk')).default
      const apiKey = getByoakValue(ctx.byoak, 'anthropic', 'API_KEY') ?? ''
      const client = new Anthropic({ apiKey })

      const emotionContext = ctx.emotionState
        ? `\n\nThe user appears to be feeling ${ctx.emotionState.mood}. Be ${ctx.emotionState.primary === 'anger' || ctx.emotionState.primary === 'frustration' ? 'patient and reassuring' : ctx.emotionState.primary === 'sadness' ? 'gentle and supportive' : 'friendly and helpful'} in your response.`
        : ''

      const response = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: 'image/png', data: base64 },
              },
              { type: 'text', text: `${input.question}${emotionContext}` },
            ],
          },
        ],
      })

      const text = response.content
        .filter(b => b.type === 'text')
        .map(b => (b as { type: 'text'; text: string }).text)
        .join('\n')

      return { output: text, isError: false }
    } catch (err) {
      return { output: `Screenshot error: ${(err as Error).message}`, isError: true }
    }
  },
})
