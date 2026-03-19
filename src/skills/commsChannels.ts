import { registerSkill } from './index.js'
import type { AgentContext, SkillResult } from '../types/index.js'
import { getByoakValue } from '../config.js'

registerSkill({
  name: 'slack_send',
  description: 'Send a message to a Slack channel or thread.',
  inputSchema: {
    type: 'object',
    properties: {
      channel: { type: 'string', description: 'Slack channel ID or name (e.g. #general or C1234567)' },
      message: { type: 'string', description: 'Message text (supports Slack markdown)' },
      threadTs: { type: 'string', description: 'Thread timestamp to reply in a thread (optional)' },
    },
    required: ['channel', 'message'],
  },
  handler: async (input: Record<string, unknown>, ctx: AgentContext): Promise<SkillResult> => {
    const token = getByoakValue(ctx.byoak, 'slack', 'BOT_TOKEN')
    if (!token) return { output: 'Slack not configured: missing BYOAK_SLACK_BOT_TOKEN', isError: true }

    try {
      const { WebClient } = await import('@slack/web-api')
      const client = new WebClient(token)
      const result = await client.chat.postMessage({
        channel: String(input.channel),
        text: String(input.message),
        thread_ts: input.threadTs ? String(input.threadTs) : undefined,
      })
      return { output: `Message sent to ${input.channel} (ts: ${result.ts})`, isError: false }
    } catch (err) {
      return { output: `Slack error: ${(err as Error).message}`, isError: true }
    }
  },
})

registerSkill({
  name: 'slack_update_message',
  description: 'Update/edit an existing Slack message (useful for replacing "Processing..." with the final result).',
  inputSchema: {
    type: 'object',
    properties: {
      channel: { type: 'string', description: 'Channel where the message is' },
      ts: { type: 'string', description: 'Timestamp of the message to update' },
      message: { type: 'string', description: 'New message text' },
    },
    required: ['channel', 'ts', 'message'],
  },
  handler: async (input: Record<string, unknown>, ctx: AgentContext): Promise<SkillResult> => {
    const token = getByoakValue(ctx.byoak, 'slack', 'BOT_TOKEN')
    if (!token) return { output: 'Slack not configured', isError: true }

    try {
      const { WebClient } = await import('@slack/web-api')
      const client = new WebClient(token)
      await client.chat.update({
        channel: String(input.channel),
        ts: String(input.ts),
        text: String(input.message),
      })
      return { output: 'Message updated', isError: false }
    } catch (err) {
      return { output: `Slack update error: ${(err as Error).message}`, isError: true }
    }
  },
})

registerSkill({
  name: 'telegram_send',
  description: 'Send a message to a Telegram chat.',
  inputSchema: {
    type: 'object',
    properties: {
      chatId: { type: 'string', description: 'Telegram chat ID (numeric or @username)' },
      message: { type: 'string', description: 'Message text (supports MarkdownV2)' },
      parseMode: { type: 'string', enum: ['MarkdownV2', 'HTML', 'Markdown'], description: 'Parse mode (optional)' },
    },
    required: ['chatId', 'message'],
  },
  handler: async (input: Record<string, unknown>, ctx: AgentContext): Promise<SkillResult> => {
    const token = getByoakValue(ctx.byoak, 'telegram', 'BOT_TOKEN')
    if (!token) return { output: 'Telegram not configured: missing BYOAK_TELEGRAM_BOT_TOKEN', isError: true }

    try {
      const { Bot } = await import('grammy')
      const bot = new Bot(token)
      const msg = await bot.api.sendMessage(String(input.chatId), String(input.message), {
        parse_mode: (input.parseMode as 'MarkdownV2' | 'HTML' | 'Markdown') ?? undefined,
      })
      return { output: `Telegram message sent (id: ${msg.message_id})`, isError: false }
    } catch (err) {
      return { output: `Telegram error: ${(err as Error).message}`, isError: true }
    }
  },
})
