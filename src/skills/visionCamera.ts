import { registerSkill } from './index.js'
import type { AgentContext, SkillResult } from '../types/index.js'
import { tmpdir } from 'os'
import { join } from 'path'
import { unlink, readFile } from 'fs/promises'
import { randomUUID } from 'crypto'
import { getByoakValue } from '../config.js'

registerSkill({
  name: 'vision_camera',
  description: 'Capture a frame from the webcam and analyze it with Claude Vision. Useful for environmental awareness (e.g., "Am I at my desk?", "What is in front of the camera?").',
  inputSchema: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description: 'What to analyze or identify in the camera frame',
      },
    },
    required: ['question'],
  },
  handler: async (input: Record<string, unknown>, ctx: AgentContext): Promise<SkillResult> => {
    const tmpPath = join(tmpdir(), `jarvis-cam-${randomUUID()}.jpg`)

    try {
      const NodeWebcam = await import('node-webcam')
      const cam = NodeWebcam.default.create({
        width: 640,
        height: 480,
        quality: 85,
        output: 'jpeg',
        device: false,
        callbackReturn: 'location',
        verbose: false,
      })

      await new Promise<void>((resolve, reject) => {
        cam.capture(tmpPath.replace('.jpg', ''), (err: Error | null) => {
          if (err) reject(err)
          else resolve()
        })
      })

      const imgBuffer = await readFile(tmpPath)
      const base64 = imgBuffer.toString('base64')

      const Anthropic = (await import('@anthropic-ai/sdk')).default
      const apiKey = getByoakValue(ctx.byoak, 'anthropic', 'API_KEY') ?? ''
      const client = new Anthropic({ apiKey })

      const emotionContext = ctx.emotionState
        ? `\n\nContext: The user seems to be in a ${ctx.emotionState.mood} mood. Respond in a warm and ${ctx.emotionState.primary === 'neutral' ? 'helpful' : 'empathetic'} manner.`
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
                source: { type: 'base64', media_type: 'image/jpeg', data: base64 },
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
      const errorMsg = (err as Error).message
      if (errorMsg.includes('No cameras available') || errorMsg.includes('NotFoundError')) {
        return { output: "I couldn't access the camera. Make sure it's connected and you have given permission to use it.", isError: true }
      }
      return { output: `Camera error: ${errorMsg}`, isError: true }
    } finally {
      await unlink(tmpPath).catch(() => {})
    }
  },
})
