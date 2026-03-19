import { registerSkill } from './index.js'
import type { AgentContext, SkillResult } from '../types/index.js'
import { getByoakValue } from '../config.js'

async function getGChatClient(ctx: AgentContext) {
  const serviceAccountKey = getByoakValue(ctx.byoak, 'gchat', 'SERVICE_ACCOUNT_KEY')

  if (!serviceAccountKey) {
    throw new Error('Google Chat not configured: missing BYOAK_GCHAT_SERVICE_ACCOUNT_KEY')
  }

  const { google } = await import('googleapis')

  // Service account key can be a JSON string or a file path
  let credentials: Record<string, string>
  try {
    credentials = JSON.parse(serviceAccountKey) as Record<string, string>
  } catch {
    // If not JSON, treat as file path
    const { readFileSync } = await import('fs')
    credentials = JSON.parse(readFileSync(serviceAccountKey, 'utf-8')) as Record<string, string>
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/chat.bot'],
  })

  return google.chat({ version: 'v1', auth })
}

registerSkill({
  name: 'gchat_send',
  description: 'Send a message to a Google Chat space.',
  inputSchema: {
    type: 'object',
    properties: {
      spaceName: { type: 'string', description: 'Google Chat space name (e.g. "spaces/AAAA...")' },
      message: { type: 'string', description: 'Message text to send' },
      threadKey: { type: 'string', description: 'Optional thread key to reply within a thread' },
    },
    required: ['spaceName', 'message'],
  },
  handler: async (input: Record<string, unknown>, ctx: AgentContext): Promise<SkillResult> => {
    try {
      const chat = await getGChatClient(ctx)

      const requestBody: Record<string, unknown> = {
        text: String(input.message),
      }

      if (input.threadKey) {
        requestBody.thread = { threadKey: String(input.threadKey) }
      }

      const res = await chat.spaces.messages.create({
        parent: String(input.spaceName),
        requestBody,
        ...(input.threadKey ? { messageReplyOption: 'REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD' } : {}),
      })

      return {
        output: `Message sent to ${input.spaceName} (name: ${res.data.name})`,
        isError: false,
      }
    } catch (err) {
      return { output: `Google Chat error: ${(err as Error).message}`, isError: true }
    }
  },
})

registerSkill({
  name: 'gchat_list_spaces',
  description: 'List Google Chat spaces the bot has access to.',
  inputSchema: {
    type: 'object',
    properties: {
      pageSize: { type: 'number', description: 'Max spaces to return (default: 20)' },
    },
    required: [],
  },
  handler: async (input: Record<string, unknown>, ctx: AgentContext): Promise<SkillResult> => {
    try {
      const chat = await getGChatClient(ctx)
      const res = await chat.spaces.list({
        pageSize: Number(input.pageSize ?? 20),
      })

      const spaces = res.data.spaces ?? []
      if (spaces.length === 0) return { output: 'No spaces found', isError: false }

      const formatted = spaces.map(s =>
        `• ${s.displayName ?? 'Unnamed'} (${s.name}) — type: ${s.type}`
      )
      return { output: formatted.join('\n'), isError: false }
    } catch (err) {
      return { output: `Google Chat error: ${(err as Error).message}`, isError: true }
    }
  },
})
