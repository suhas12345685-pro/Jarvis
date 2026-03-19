import { registerSkill } from './index.js'
import type { AgentContext, SkillResult } from '../types/index.js'
import { getDiscordClient } from '../channels/discord.js'

registerSkill({
  name: 'discord_send',
  description: 'Send a message to a Discord channel by channel ID.',
  inputSchema: {
    type: 'object',
    properties: {
      channelId: { type: 'string', description: 'Discord channel ID to send to' },
      message: { type: 'string', description: 'Message text to send' },
    },
    required: ['channelId', 'message'],
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    try {
      const client = getDiscordClient()
      if (!client) {
        return { output: 'Discord not configured or not connected', isError: true }
      }

      const channel = await client.channels.fetch(String(input.channelId))
      if (!channel || !channel.isTextBased()) {
        return { output: 'Channel not found or not a text channel', isError: true }
      }

      // channel.send exists on text-based channels
      const sent = await (channel as { send: (msg: string) => Promise<{ id: string }> }).send(String(input.message))
      return { output: `Message sent (ID: ${sent.id})`, isError: false }
    } catch (err) {
      return { output: `Discord send error: ${(err as Error).message}`, isError: true }
    }
  },
})

registerSkill({
  name: 'discord_reply',
  description: 'Reply to a specific Discord message.',
  inputSchema: {
    type: 'object',
    properties: {
      channelId: { type: 'string', description: 'Channel ID containing the message' },
      messageId: { type: 'string', description: 'Message ID to reply to' },
      message: { type: 'string', description: 'Reply text' },
    },
    required: ['channelId', 'messageId', 'message'],
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    try {
      const client = getDiscordClient()
      if (!client) {
        return { output: 'Discord not configured or not connected', isError: true }
      }

      const channel = await client.channels.fetch(String(input.channelId))
      if (!channel || !channel.isTextBased()) {
        return { output: 'Channel not found or not a text channel', isError: true }
      }

      const textChannel = channel as { messages: { fetch: (id: string) => Promise<{ reply: (msg: string) => Promise<{ id: string }> }> } }
      const original = await textChannel.messages.fetch(String(input.messageId))
      const reply = await original.reply(String(input.message))
      return { output: `Reply sent (ID: ${reply.id})`, isError: false }
    } catch (err) {
      return { output: `Discord reply error: ${(err as Error).message}`, isError: true }
    }
  },
})
