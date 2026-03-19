import express, { type Request, type Response, type NextFunction } from 'express'
import { EventEmitter } from 'events'
import { createHmac, timingSafeEqual } from 'crypto'
import { Queue, Worker, type Job } from 'bullmq'
import type { AppConfig, AgentContext } from './types/index.js'
import type { MemoryLayer } from './memoryLayer.js'
import { runToolLoop } from './toolCaller.js'
import { getLogger } from './logger.js'

export const jarvisEvents = new EventEmitter()

interface AgentJob {
  ctx: Omit<AgentContext, 'sendInterim' | 'sendFinal'>
  channelPayload: Record<string, unknown>
}

export function createRouter(config: AppConfig, memory: MemoryLayer) {
  const app = express()
  const logger = getLogger()

  // ── Queue ─────────────────────────────────────────────────────────────────
  const queue = new Queue<AgentJob>('agent-tasks', {
    connection: { url: config.redisUrl },
  })

  const worker = new Worker<AgentJob>(
    'agent-tasks',
    async (job: Job<AgentJob>) => {
      const { ctx: ctxData } = job.data

      const ctx: AgentContext = {
        ...ctxData,
        sendInterim: async (msg: string) => {
          jarvisEvents.emit('interim', { threadId: ctxData.threadId, message: msg })
          return undefined
        },
        sendFinal: async (msg: string) => {
          jarvisEvents.emit('final', { threadId: ctxData.threadId, message: msg })
        },
      }

      jarvisEvents.emit('task:start', { userId: ctx.userId, threadId: ctx.threadId })

      try {
        const result = await runToolLoop(ctx, config.anthropicApiKey)
        await ctx.sendFinal(result, ctx.interimMessageId)
        await memory.insertMemory(
          `User: ${ctx.rawMessage}\nAssistant: ${result}`,
          { userId: ctx.userId, channelType: ctx.channelType }
        )
        jarvisEvents.emit('task:complete', { userId: ctx.userId, result })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        logger.error('Task failed', { userId: ctx.userId, error: msg })
        jarvisEvents.emit('task:error', { userId: ctx.userId, error: msg })
        await ctx.sendFinal(`Sorry, I encountered an error: ${msg}`)
      }
    },
    { connection: { url: config.redisUrl }, concurrency: 5 }
  )

  worker.on('failed', (job, err) => {
    logger.error('Worker job failed', { jobId: job?.id, error: err.message })
  })

  // ── Middleware ─────────────────────────────────────────────────────────────
  // Raw body for HMAC, parsed JSON for everything else
  app.use('/webhooks/slack', express.raw({ type: 'application/json' }))
  app.use(express.json())

  // ── Context Compiler ──────────────────────────────────────────────────────
  async function compileContext(
    channelType: AgentContext['channelType'],
    userId: string,
    threadId: string,
    rawMessage: string,
    sendInterim: AgentContext['sendInterim'],
    sendFinal: AgentContext['sendFinal']
  ): Promise<AgentContext> {
    const memories = await memory.semanticSearch(rawMessage, 5)
    const memoryBlock = memories.length > 0
      ? `\n\nRelevant memories:\n${memories.map(m => `- ${m.content}`).join('\n')}`
      : ''

    const systemPrompt = `You are speaking with user ${userId} via ${channelType}.${memoryBlock}`

    return {
      channelType,
      userId,
      threadId,
      rawMessage,
      memories,
      systemPrompt,
      byoak: config.byoak,
      sendInterim,
      sendFinal,
    }
  }

  // ── Slack Webhook ─────────────────────────────────────────────────────────
  app.post('/webhooks/slack', async (req: Request, res: Response) => {
    const signingSecret = config.byoak.find(e => e.service === 'slack' && e.keyName === 'SIGNING_SECRET')?.value
    if (!signingSecret) {
      res.status(403).json({ error: 'Slack not configured' })
      return
    }

    const rawBody = req.body as Buffer
    const timestamp = req.headers['x-slack-request-timestamp'] as string
    const slackSig = req.headers['x-slack-signature'] as string

    // Replay attack check (5 minute window)
    if (Math.abs(Date.now() / 1000 - parseInt(timestamp, 10)) > 300) {
      res.status(403).json({ error: 'Request too old' })
      return
    }

    const sigBase = `v0:${timestamp}:${rawBody.toString('utf-8')}`
    const computed = `v0=${createHmac('sha256', signingSecret).update(sigBase).digest('hex')}`
    try {
      if (!timingSafeEqual(Buffer.from(computed), Buffer.from(slackSig))) {
        res.status(403).json({ error: 'Invalid signature' })
        return
      }
    } catch {
      res.status(403).json({ error: 'Invalid signature' })
      return
    }

    const body = JSON.parse(rawBody.toString('utf-8')) as Record<string, unknown>

    // URL verification challenge
    if (body.type === 'url_verification') {
      res.json({ challenge: body.challenge })
      return
    }

    const event = body.event as Record<string, unknown> | undefined
    if (!event || event.type !== 'app_mention' || event.bot_id) {
      res.status(200).end()
      return
    }

    const userId = event.user as string
    const threadId = (event.thread_ts ?? event.ts) as string
    const channel = event.channel as string
    const rawMessage = (event.text as string).replace(/<@[A-Z0-9]+>/g, '').trim()

    res.status(200).end()

    const { WebClient } = await import('@slack/web-api')
    const botToken = config.byoak.find(e => e.service === 'slack' && e.keyName === 'BOT_TOKEN')?.value
    const slackClient = botToken ? new WebClient(botToken) : null

    const sendInterim: AgentContext['sendInterim'] = async (msg: string) => {
      if (!slackClient) return undefined
      const r = await slackClient.chat.postMessage({ channel, thread_ts: threadId, text: msg })
      return r.ts as string
    }

    const sendFinal: AgentContext['sendFinal'] = async (msg: string, interimId?: string) => {
      if (!slackClient) return
      if (interimId) {
        await slackClient.chat.update({ channel, ts: interimId, text: msg }).catch(() => {
          slackClient.chat.postMessage({ channel, thread_ts: threadId, text: msg })
        })
      } else {
        await slackClient.chat.postMessage({ channel, thread_ts: threadId, text: msg })
      }
    }

    const ctx = await compileContext('slack', userId, threadId, rawMessage, sendInterim, sendFinal)
    await queue.add('slack-message', { ctx: { ...ctx, sendInterim: undefined as unknown as AgentContext['sendInterim'], sendFinal: undefined as unknown as AgentContext['sendFinal'] }, channelPayload: { channel, threadId } })

    // For in-process handling (simpler), run directly if not using queue
    await runToolLoop(ctx, config.anthropicApiKey).then(
      result => sendFinal(result, ctx.interimMessageId)
    ).catch(err => {
      logger.error('Slack handler error', { error: err })
      sendFinal('Sorry, something went wrong.')
    })
  })

  // ── Telegram Webhook ──────────────────────────────────────────────────────
  app.post('/webhooks/telegram', async (req: Request, res: Response) => {
    const secret = req.headers['x-telegram-bot-api-secret-token']
    const expectedSecret = config.byoak.find(e => e.service === 'telegram' && e.keyName === 'WEBHOOK_SECRET')?.value

    if (expectedSecret && secret !== expectedSecret) {
      res.status(403).json({ error: 'Invalid token' })
      return
    }

    const update = req.body as Record<string, unknown>
    const message = update.message as Record<string, unknown> | undefined
    if (!message?.text) { res.status(200).end(); return }

    const userId = String((message.from as Record<string, unknown>)?.id)
    const chatId = String((message.chat as Record<string, unknown>)?.id)
    const threadId = String(message.message_id)
    const rawMessage = message.text as string

    res.status(200).end()

    const botToken = config.byoak.find(e => e.service === 'telegram' && e.keyName === 'BOT_TOKEN')?.value
    const { Bot } = await import('grammy')
    const bot = botToken ? new Bot(botToken) : null

    let interimMsgId: number | undefined

    const sendInterim: AgentContext['sendInterim'] = async (msg: string) => {
      if (!bot) return undefined
      const m = await bot.api.sendMessage(chatId, msg)
      interimMsgId = m.message_id
      return String(m.message_id)
    }

    const sendFinal: AgentContext['sendFinal'] = async (msg: string) => {
      if (!bot) return
      if (interimMsgId) {
        await bot.api.editMessageText(chatId, interimMsgId, msg).catch(() => {
          bot.api.sendMessage(chatId, msg)
        })
      } else {
        await bot.api.sendMessage(chatId, msg)
      }
    }

    const ctx = await compileContext('telegram', userId, threadId, rawMessage, sendInterim, sendFinal)
    await runToolLoop(ctx, config.anthropicApiKey).then(
      result => sendFinal(result, ctx.interimMessageId)
    ).catch(err => {
      logger.error('Telegram handler error', { error: err })
      sendFinal('Sorry, something went wrong.')
    })
  })

  // ── Health ─────────────────────────────────────────────────────────────────
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', version: '1.0.0' })
  })

  // ── Error handler ──────────────────────────────────────────────────────────
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error('Unhandled express error', { error: err.message })
    res.status(500).json({ error: 'Internal error' })
  })

  return { app, queue, worker }
}
