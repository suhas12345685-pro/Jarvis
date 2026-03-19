import { Client, GatewayIntentBits, type Message } from 'discord.js'
import type { Queue } from 'bullmq'
import type { AppConfig } from '../types/index.js'
import type { MemoryLayer } from '../memoryLayer.js'
import { getByoakValue } from '../config.js'
import { getLogger } from '../logger.js'

// Singleton Discord client (accessible by skills for proactive messaging)
let _client: Client | null = null

export function getDiscordClient(): Client | null {
  return _client
}

/**
 * Start the Discord bot client.
 * Uses WebSocket gateway (not webhooks) — runs alongside Express.
 * No-op if BYOAK_DISCORD_BOT_TOKEN is not configured.
 */
export async function startDiscordClient(
  config: AppConfig,
  _memory: MemoryLayer,
  queue: Queue
): Promise<void> {
  const logger = getLogger()
  const botToken = getByoakValue(config.byoak, 'discord', 'BOT_TOKEN')

  if (!botToken) {
    logger.info('Discord bot token not configured — Discord channel disabled')
    return
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
  })

  client.once('ready', () => {
    logger.info('Discord bot connected', { username: client.user?.tag })
  })

  client.on('messageCreate', async (message: Message) => {
    // Ignore bot messages
    if (message.author.bot) return

    // Only respond to mentions or DMs
    const isMentioned = message.mentions.has(client.user!.id)
    const isDM = !message.guild
    if (!isMentioned && !isDM) return

    const userId = message.author.id
    const threadId = message.channel.id
    const rawMessage = message.content
      .replace(/<@!?\d+>/g, '')  // Strip mentions
      .trim()

    if (!rawMessage) return

    logger.info('Discord message received', { userId, channel: threadId })

    // Enqueue to BullMQ — same as Slack/Telegram
    await queue.add('discord-message', {
      channelType: 'discord' as const,
      userId,
      threadId,
      rawMessage,
      channelPayload: {
        channelId: message.channel.id,
        messageId: message.id,
        guildId: message.guild?.id,
      },
    })
  })

  await client.login(botToken)
  _client = client
  logger.info('Discord client started')
}
