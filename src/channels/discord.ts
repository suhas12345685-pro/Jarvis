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
 * Start the Discord bot client with persistent WebSocket gateway.
 *
 * RBAC: Only processes commands from the configured OWNER_USER_ID.
 * All other users get a polite refusal.
 *
 * Real-time trigger: Incoming messages from the owner instantly wake
 * the agent loop via the BullMQ queue with priority=1.
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

  const ownerUserId = config.ownerUserId
  if (!ownerUserId) {
    logger.warn('OWNER_USER_ID not set — Discord RBAC will reject ALL commands. Set it in .env')
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
    logger.info('Discord bot connected (persistent WebSocket)', { username: client.user?.tag })
  })

  client.on('messageCreate', async (message: Message) => {
    // Ignore bot messages
    if (message.author.bot) return

    // Only respond to mentions or DMs
    const isMentioned = message.mentions.has(client.user!.id)
    const isDM = !message.guild
    if (!isMentioned && !isDM) return

    const userId = message.author.id

    // ── RBAC: Strict owner-only access ────────────────────────────────
    if (ownerUserId && userId !== ownerUserId) {
      logger.warn('Discord RBAC: unauthorized user rejected', { userId, username: message.author.tag })
      await message.reply('I only respond to my owner. Access denied.')
      return
    }

    const threadId = message.channel.id
    const rawMessage = message.content
      .replace(/<@!?\d+>/g, '')  // Strip mentions
      .trim()

    if (!rawMessage) return

    logger.info('Discord message received (RBAC: authorized)', { userId, channel: threadId })

    // Real-time wake trigger — priority 1 for instant processing
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
    }, { priority: 1 })
  })

  // Persistent WebSocket — auto-reconnects built into discord.js
  await client.login(botToken)
  _client = client
  logger.info('Discord client started with persistent WebSocket + RBAC enforcement')
}
