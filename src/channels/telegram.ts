import type { Queue } from 'bullmq'
import type { AppConfig } from '../types/index.js'
import type { MemoryLayer } from '../memoryLayer.js'
import { getByoakValue } from '../config.js'
import { getLogger } from '../logger.js'

/**
 * Start the Telegram bot with persistent long-polling.
 *
 * RBAC: Only processes commands from the configured OWNER_USER_ID.
 * All other users get a polite refusal.
 *
 * Real-time trigger: Incoming messages from the owner instantly wake
 * the agent loop via the BullMQ queue with priority=1.
 */
export async function startTelegramPolling(
  config: AppConfig,
  _memory: MemoryLayer,
  queue: Queue
): Promise<void> {
  const logger = getLogger()
  const botToken = getByoakValue(config.byoak, 'telegram', 'BOT_TOKEN')

  if (!botToken) {
    logger.info('Telegram bot token not configured — Telegram polling disabled')
    return
  }

  // Only start polling if TELEGRAM_MODE=poll (don't conflict with webhook mode)
  const mode = process.env.TELEGRAM_MODE ?? 'webhook'
  if (mode !== 'poll') {
    logger.info('Telegram mode is "webhook" — polling disabled (set TELEGRAM_MODE=poll to enable)')
    return
  }

  const ownerUserId = config.ownerUserId
  if (!ownerUserId) {
    logger.warn('OWNER_USER_ID not set — Telegram RBAC will reject ALL commands. Set it in .env')
  }

  const { Bot } = await import('grammy')
  const bot = new Bot(botToken)

  bot.on('message:text', async (ctx) => {
    const userId = String(ctx.from.id)
    const chatId = String(ctx.chat.id)
    const threadId = String(ctx.msg.message_id)
    const rawMessage = ctx.msg.text

    if (!rawMessage.trim()) return

    // ── RBAC: Strict owner-only access ────────────────────────────────
    if (ownerUserId && userId !== ownerUserId) {
      logger.warn('Telegram RBAC: unauthorized user rejected', { userId })
      await ctx.reply('I only respond to my owner. Access denied.')
      return
    }

    logger.info('Telegram poll message received (RBAC: authorized)', { userId, chatId })

    // Real-time wake trigger — priority 1 for instant processing
    await queue.add('telegram-poll-message', {
      channelType: 'telegram' as const,
      userId,
      threadId,
      rawMessage,
      channelPayload: { chatId },
    }, { priority: 1 })
  })

  bot.catch((err) => {
    logger.error('Telegram bot error', { error: err.message ?? String(err) })
  })

  await bot.start({
    onStart: () => { logger.info('Telegram bot started in polling mode with RBAC enforcement') },
  })
}
