import type { Queue } from 'bullmq'
import type { AppConfig } from '../types/index.js'
import type { MemoryLayer } from '../memoryLayer.js'
import { getByoakValue } from '../config.js'
import { getLogger } from '../logger.js'

/**
 * Start the Telegram bot in long-polling mode.
 * This is an alternative to the webhook approach — useful for development
 * or when you can't expose a public URL.
 *
 * No-op if BYOAK_TELEGRAM_BOT_TOKEN is not configured or if
 * TELEGRAM_MODE is set to 'webhook' (default is 'poll' when running locally).
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

  const { Bot } = await import('grammy')
  const bot = new Bot(botToken)

  bot.on('message:text', async (ctx) => {
    const userId = String(ctx.from.id)
    const chatId = String(ctx.chat.id)
    const threadId = String(ctx.msg.message_id)
    const rawMessage = ctx.msg.text

    if (!rawMessage.trim()) return

    logger.info('Telegram poll message received', { userId, chatId })

    await queue.add('telegram-poll-message', {
      channelType: 'telegram' as const,
      userId,
      threadId,
      rawMessage,
      channelPayload: { chatId },
    })
  })

  bot.catch((err) => {
    logger.error('Telegram bot error', { error: err.message ?? String(err) })
  })

  await bot.start({
    onStart: () => { logger.info('Telegram bot started in polling mode') },
  })
}
