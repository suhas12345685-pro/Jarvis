import express, { type Request, type Response, type NextFunction } from 'express'
import { EventEmitter } from 'events'
import { createHmac, timingSafeEqual } from 'crypto'
import { Queue, Worker, type Job } from 'bullmq'
import type { AppConfig, AgentContext } from './types/index.js'
import type { MemoryLayer } from './memoryLayer.js'
import { runToolLoop } from './toolCaller.js'
import { getLogger } from './logger.js'
import { IPRateLimiter } from './security.js'
<<<<<<< HEAD
import { getEmotionEngine, type EmotionEngine } from './emotionEngine.js'
=======
>>>>>>> e0d59e7b5270ae6d2f51bb3f447c22895f8fee54

export const jarvisEvents = new EventEmitter()

interface AgentJob {
  channelType: AgentContext['channelType']
  userId: string
  threadId: string
  rawMessage: string
  channelPayload: Record<string, unknown>
}

<<<<<<< HEAD
=======
// ── Simple per-user rate limiter ───────────────────────────────────────────────

>>>>>>> e0d59e7b5270ae6d2f51bb3f447c22895f8fee54
class RateLimiter {
  private requests = new Map<string, number[]>()
  private readonly windowMs: number
  private readonly maxRequests: number

  constructor(windowMs = 60_000, maxRequests = 20) {
    this.windowMs = windowMs
    this.maxRequests = maxRequests
  }

  isAllowed(key: string): boolean {
    const now = Date.now()
    const timestamps = this.requests.get(key) ?? []
    const recent = timestamps.filter(t => now - t < this.windowMs)
    if (recent.length >= this.maxRequests) return false
    recent.push(now)
    this.requests.set(key, recent)
    return true
  }
}

export function createRouter(config: AppConfig, memory: MemoryLayer) {
  const app = express()
  const logger = getLogger()
  const rateLimiter = new RateLimiter()
<<<<<<< HEAD
  const ipRateLimiter = new IPRateLimiter(60_000, 100)
  let emotionEngine: EmotionEngine

  try {
    emotionEngine = getEmotionEngine()
  } catch {
    emotionEngine = getEmotionEngine()
  }

=======
  const ipRateLimiter = new IPRateLimiter(60_000, 100) // 100 req/min per IP

  // ── Queue ─────────────────────────────────────────────────────────────────
>>>>>>> e0d59e7b5270ae6d2f51bb3f447c22895f8fee54
  const queue = new Queue<AgentJob>('agent-tasks', {
    connection: { url: config.redisUrl },
  })

  const worker = new Worker<AgentJob>(
    'agent-tasks',
    async (job: Job<AgentJob>) => {
      const { channelType, userId, threadId, rawMessage, channelPayload } = job.data

<<<<<<< HEAD
=======
      // Build channel-specific send functions from payload
>>>>>>> e0d59e7b5270ae6d2f51bb3f447c22895f8fee54
      const { sendInterim, sendFinal } = await buildChannelCallbacks(
        channelType, channelPayload, config
      )

<<<<<<< HEAD
      emotionEngine.updateEmotion(userId, rawMessage)
      const emotionState = emotionEngine.getOrCreateState(userId)
      const personality = emotionEngine.getPersonality(userId)

      const ctx = await compileContext(
        channelType, userId, threadId, rawMessage, sendInterim, sendFinal,
        emotionState, personality
      )

      jarvisEvents.emit('task:start', { userId, threadId, emotion: emotionState.primary })

      try {
        const result = await runToolLoop(ctx, config)
        const emotionalResult = emotionEngine.generateEmpatheticResponse(userId, result, emotionState.primary)

        await sendFinal(emotionalResult.response, ctx.interimMessageId)

        await memory.insertMemory(
          `User: ${rawMessage}\nAssistant: ${result}`,
          { userId, channelType, emotion: emotionState.primary }
        )

        emotionEngine.calibratePersonalityFromInteraction(userId, rawMessage, result)

        jarvisEvents.emit('task:complete', { userId, result: emotionalResult.response, emotion: emotionState.primary })
=======
      const ctx = await compileContext(
        channelType, userId, threadId, rawMessage, sendInterim, sendFinal
      )

      jarvisEvents.emit('task:start', { userId, threadId })

      try {
        const result = await runToolLoop(ctx, config)
        await sendFinal(result, ctx.interimMessageId)
        await memory.insertMemory(
          `User: ${rawMessage}\nAssistant: ${result}`,
          { userId, channelType }
        )
        jarvisEvents.emit('task:complete', { userId, result })
>>>>>>> e0d59e7b5270ae6d2f51bb3f447c22895f8fee54
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        logger.error('Task failed', { userId, error: msg })
        jarvisEvents.emit('task:error', { userId, error: msg })
        await sendFinal(`Sorry, I encountered an error: ${msg}`)
      }
    },
    { connection: { url: config.redisUrl }, concurrency: 5 }
  )

  worker.on('failed', (job, err) => {
    logger.error('Worker job failed', { jobId: job?.id, error: err.message })
  })

<<<<<<< HEAD
  setInterval(() => {
    emotionEngine.decayEmotions()
  }, 60000)
=======
  // ── Channel callback builder ────────────────────────────────────────────
>>>>>>> e0d59e7b5270ae6d2f51bb3f447c22895f8fee54

  async function buildChannelCallbacks(
    channelType: AgentContext['channelType'],
    payload: Record<string, unknown>,
    cfg: AppConfig
  ): Promise<{ sendInterim: AgentContext['sendInterim']; sendFinal: AgentContext['sendFinal'] }> {
    if (channelType === 'slack') {
      const { WebClient } = await import('@slack/web-api')
      const botToken = cfg.byoak.find(e => e.service === 'slack' && e.keyName === 'BOT_TOKEN')?.value
      const slackClient = botToken ? new WebClient(botToken) : null
      const channel = payload.channel as string
      const threadTs = payload.threadId as string

      return {
        sendInterim: async (msg: string) => {
          if (!slackClient) return undefined
          const r = await slackClient.chat.postMessage({ channel, thread_ts: threadTs, text: msg })
          return r.ts as string
        },
        sendFinal: async (msg: string, interimId?: string) => {
          if (!slackClient) return
          if (interimId) {
            await slackClient.chat.update({ channel, ts: interimId, text: msg }).catch(() => {
              slackClient.chat.postMessage({ channel, thread_ts: threadTs, text: msg })
            })
          } else {
            await slackClient.chat.postMessage({ channel, thread_ts: threadTs, text: msg })
          }
        },
      }
    }

    if (channelType === 'telegram') {
      const botToken = cfg.byoak.find(e => e.service === 'telegram' && e.keyName === 'BOT_TOKEN')?.value
      const { Bot } = await import('grammy')
      const bot = botToken ? new Bot(botToken) : null
      const chatId = payload.chatId as string
      let interimMsgId: number | undefined

      return {
        sendInterim: async (msg: string) => {
          if (!bot) return undefined
          const m = await bot.api.sendMessage(chatId, msg)
          interimMsgId = m.message_id
          return String(m.message_id)
        },
        sendFinal: async (msg: string) => {
          if (!bot) return
          if (interimMsgId) {
            await bot.api.editMessageText(chatId, interimMsgId, msg).catch(() => {
              bot.api.sendMessage(chatId, msg)
            })
          } else {
            await bot.api.sendMessage(chatId, msg)
          }
        },
      }
    }

    if (channelType === 'discord') {
      const { getDiscordClient } = await import('./channels/discord.js')
      const client = getDiscordClient()
      const channelId = payload.channelId as string
      let interimMsgRef: { id: string } | undefined

      return {
        sendInterim: async (msg: string) => {
          if (!client) return undefined
          const ch = await client.channels.fetch(channelId)
          if (ch?.isTextBased()) {
            const sent = await (ch as unknown as { send: (m: string) => Promise<{ id: string }> }).send(msg)
            interimMsgRef = sent
            return sent.id
          }
          return undefined
        },
        sendFinal: async (msg: string) => {
          if (!client) return
          const ch = await client.channels.fetch(channelId)
          if (!ch?.isTextBased()) return
          const textCh = ch as unknown as { messages: { fetch: (id: string) => Promise<{ edit: (m: string) => Promise<void> }> }; send: (m: string) => Promise<void> }
          if (interimMsgRef) {
            await textCh.messages.fetch(interimMsgRef.id).then(m => m.edit(msg)).catch(() => {
              textCh.send(msg)
            })
          } else {
            await textCh.send(msg)
          }
        },
      }
    }

    if (channelType === 'gchat') {
      const spaceName = payload.spaceName as string
      const { google } = await import('googleapis')
      const serviceAccountKey = cfg.byoak.find(e => e.service === 'gchat' && e.keyName === 'SERVICE_ACCOUNT_KEY')?.value

      const getChat = async () => {
        if (!serviceAccountKey) return null
        let creds: Record<string, string>
        try {
          creds = JSON.parse(serviceAccountKey) as Record<string, string>
        } catch {
          const { readFileSync } = await import('fs')
          creds = JSON.parse(readFileSync(serviceAccountKey, 'utf-8')) as Record<string, string>
        }
        const auth = new google.auth.GoogleAuth({
          credentials: creds,
          scopes: ['https://www.googleapis.com/auth/chat.bot'],
        })
        return google.chat({ version: 'v1', auth })
      }

      let interimMessageName: string | undefined

      return {
        sendInterim: async (msg: string) => {
          const chat = await getChat()
          if (!chat) return undefined
          const res = await chat.spaces.messages.create({
            parent: spaceName,
            requestBody: { text: msg },
          })
          interimMessageName = res.data.name ?? undefined
          return interimMessageName
        },
        sendFinal: async (msg: string) => {
          const chat = await getChat()
          if (!chat) return
          if (interimMessageName) {
            await chat.spaces.messages.update({
              name: interimMessageName,
              updateMask: 'text',
              requestBody: { text: msg },
            }).catch(() => {
              chat.spaces.messages.create({ parent: spaceName, requestBody: { text: msg } })
            })
          } else {
            await chat.spaces.messages.create({ parent: spaceName, requestBody: { text: msg } })
          }
        },
      }
    }

<<<<<<< HEAD
=======
    // Default for API channel — collect responses via events
>>>>>>> e0d59e7b5270ae6d2f51bb3f447c22895f8fee54
    return {
      sendInterim: async (msg: string) => {
        jarvisEvents.emit('interim', { message: msg })
        return undefined
      },
      sendFinal: async (msg: string) => {
        jarvisEvents.emit('final', { message: msg })
      },
    }
  }

<<<<<<< HEAD
  app.use('/webhooks/slack', express.raw({ type: 'application/json' }))
  app.use(express.json({ limit: '1mb' }))

=======
  // ── Middleware ─────────────────────────────────────────────────────────────
  // Raw body for HMAC, parsed JSON for everything else
  app.use('/webhooks/slack', express.raw({ type: 'application/json' }))
  app.use(express.json({ limit: '1mb' }))

  // IP-based rate limiting for all endpoints
>>>>>>> e0d59e7b5270ae6d2f51bb3f447c22895f8fee54
  app.use((req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown'
    if (!ipRateLimiter.isAllowed(ip)) {
      res.status(429).json({ error: 'Too many requests from this IP' })
      return
    }
    next()
  })

<<<<<<< HEAD
=======
  // ── Context Compiler ──────────────────────────────────────────────────────
>>>>>>> e0d59e7b5270ae6d2f51bb3f447c22895f8fee54
  async function compileContext(
    channelType: AgentContext['channelType'],
    userId: string,
    threadId: string,
    rawMessage: string,
    sendInterim: AgentContext['sendInterim'],
<<<<<<< HEAD
    sendFinal: AgentContext['sendFinal'],
    emotionState?: ReturnType<EmotionEngine['getOrCreateState']>,
    personality?: ReturnType<EmotionEngine['getPersonality']>
=======
    sendFinal: AgentContext['sendFinal']
>>>>>>> e0d59e7b5270ae6d2f51bb3f447c22895f8fee54
  ): Promise<AgentContext> {
    const memories = await memory.semanticSearch(rawMessage, 5)
    const memoryBlock = memories.length > 0
      ? `\n\nRelevant memories:\n${memories.map(m => `- ${m.content}`).join('\n')}`
      : ''

<<<<<<< HEAD
    const emotionBlock = emotionState
      ? `\n\nCurrent emotional context: I'm feeling ${emotionState.mood} (${emotionState.primary} at ${Math.round(emotionState.intensity * 100)}% intensity).`
      : ''

    const personalityBlock = personality
      ? `\n\nUser personality: Warmth ${Math.round(personality.warmthLevel * 100)}%, Humor ${Math.round(personality.humorLevel * 100)}%, Formality ${Math.round(personality.formalityLevel * 100)}%.`
      : ''

    const systemPrompt = `You are speaking with user ${userId} via ${channelType}.${memoryBlock}${emotionBlock}${personalityBlock}`
=======
    const systemPrompt = `You are speaking with user ${userId} via ${channelType}.${memoryBlock}`
>>>>>>> e0d59e7b5270ae6d2f51bb3f447c22895f8fee54

    return {
      channelType,
      userId,
      threadId,
      rawMessage,
      memories,
      systemPrompt,
      byoak: config.byoak,
<<<<<<< HEAD
      emotionState,
      personality,
=======
>>>>>>> e0d59e7b5270ae6d2f51bb3f447c22895f8fee54
      sendInterim,
      sendFinal,
    }
  }

<<<<<<< HEAD
=======
  // ── Slack Webhook ─────────────────────────────────────────────────────────
>>>>>>> e0d59e7b5270ae6d2f51bb3f447c22895f8fee54
  app.post('/webhooks/slack', async (req: Request, res: Response) => {
    const signingSecret = config.byoak.find(e => e.service === 'slack' && e.keyName === 'SIGNING_SECRET')?.value
    if (!signingSecret) {
      res.status(403).json({ error: 'Slack not configured' })
      return
    }

    const rawBody = req.body as Buffer
    const timestamp = req.headers['x-slack-request-timestamp'] as string
    const slackSig = req.headers['x-slack-signature'] as string

<<<<<<< HEAD
=======
    // Replay attack check (5 minute window)
>>>>>>> e0d59e7b5270ae6d2f51bb3f447c22895f8fee54
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

<<<<<<< HEAD
=======
    // URL verification challenge
>>>>>>> e0d59e7b5270ae6d2f51bb3f447c22895f8fee54
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

<<<<<<< HEAD
=======
    // Rate limit check
>>>>>>> e0d59e7b5270ae6d2f51bb3f447c22895f8fee54
    if (!rateLimiter.isAllowed(userId)) {
      res.status(429).json({ error: 'Rate limit exceeded' })
      return
    }

    res.status(200).end()

<<<<<<< HEAD
=======
    // Enqueue the task — worker handles execution
>>>>>>> e0d59e7b5270ae6d2f51bb3f447c22895f8fee54
    await queue.add('slack-message', {
      channelType: 'slack',
      userId,
      threadId,
      rawMessage,
      channelPayload: { channel, threadId },
    })
  })

<<<<<<< HEAD
=======
  // ── Telegram Webhook ──────────────────────────────────────────────────────
>>>>>>> e0d59e7b5270ae6d2f51bb3f447c22895f8fee54
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

<<<<<<< HEAD
=======
    // Rate limit check
>>>>>>> e0d59e7b5270ae6d2f51bb3f447c22895f8fee54
    if (!rateLimiter.isAllowed(userId)) {
      res.status(429).json({ error: 'Rate limit exceeded' })
      return
    }

    res.status(200).end()

<<<<<<< HEAD
=======
    // Enqueue the task — worker handles execution
>>>>>>> e0d59e7b5270ae6d2f51bb3f447c22895f8fee54
    await queue.add('telegram-message', {
      channelType: 'telegram',
      userId,
      threadId,
      rawMessage,
      channelPayload: { chatId },
    })
  })

<<<<<<< HEAD
=======
  // ── Google Chat Webhook ──────────────────────────────────────────────────
>>>>>>> e0d59e7b5270ae6d2f51bb3f447c22895f8fee54
  app.post('/webhooks/gchat', async (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>
    const msgType = body.type as string | undefined

<<<<<<< HEAD
=======
    // Google Chat sends various event types
>>>>>>> e0d59e7b5270ae6d2f51bb3f447c22895f8fee54
    if (msgType !== 'MESSAGE') {
      res.status(200).json({})
      return
    }

    const message = body.message as Record<string, unknown> | undefined
    const sender = body.user as Record<string, unknown> | undefined
    const space = body.space as Record<string, unknown> | undefined

    if (!message?.text || !sender || !space) {
      res.status(200).json({})
      return
    }

    const userId = String(sender.name ?? sender.displayName ?? 'gchat-user')
    const spaceName = String(space.name)
    const threadId = String((message.thread as Record<string, unknown>)?.name ?? spaceName)
    const rawMessage = (message.text as string)
<<<<<<< HEAD
      .replace(/@\S+/g, '')
=======
      .replace(/@\S+/g, '')  // Strip bot mentions
>>>>>>> e0d59e7b5270ae6d2f51bb3f447c22895f8fee54
      .trim()

    if (!rawMessage) {
      res.status(200).json({})
      return
    }

    if (!rateLimiter.isAllowed(userId)) {
      res.status(200).json({ text: 'Rate limit exceeded. Please wait a moment.' })
      return
    }

<<<<<<< HEAD
    res.status(200).json({})

=======
    // Respond immediately with acknowledgement (Google Chat expects fast response)
    res.status(200).json({})

    // Enqueue the task
>>>>>>> e0d59e7b5270ae6d2f51bb3f447c22895f8fee54
    await queue.add('gchat-message', {
      channelType: 'gchat' as const,
      userId,
      threadId,
      rawMessage,
      channelPayload: { spaceName, threadName: threadId },
    })
  })

<<<<<<< HEAD
=======
  // ── API Endpoint ──────────────────────────────────────────────────────────
>>>>>>> e0d59e7b5270ae6d2f51bb3f447c22895f8fee54
  app.post('/api/message', async (req: Request, res: Response) => {
    const { userId, message } = req.body as { userId?: string; message?: string }

    if (!userId || !message) {
      res.status(400).json({ error: 'userId and message are required' })
      return
    }

    if (!rateLimiter.isAllowed(userId)) {
      res.status(429).json({ error: 'Rate limit exceeded' })
      return
    }

    const threadId = `api-${Date.now()}`

    const sendInterim: AgentContext['sendInterim'] = async () => undefined
    const sendFinal: AgentContext['sendFinal'] = async () => {}

<<<<<<< HEAD
    emotionEngine.updateEmotion(userId, message)
    const emotionState = emotionEngine.getOrCreateState(userId)
    const personality = emotionEngine.getPersonality(userId)

    const ctx = await compileContext('api', userId, threadId, message, sendInterim, sendFinal, emotionState, personality)

    try {
      const result = await runToolLoop(ctx, config)
      const emotionalResult = emotionEngine.generateEmpatheticResponse(userId, result, emotionState.primary)

      await memory.insertMemory(
        `User: ${message}\nAssistant: ${result}`,
        { userId, channelType: 'api', emotion: emotionState.primary }
      )

      res.json({ result: emotionalResult.response, emotion: emotionState.primary, mood: emotionState.mood })
=======
    const ctx = await compileContext('api', userId, threadId, message, sendInterim, sendFinal)

    try {
      const result = await runToolLoop(ctx, config)
      await memory.insertMemory(
        `User: ${message}\nAssistant: ${result}`,
        { userId, channelType: 'api' }
      )
      res.json({ result })
>>>>>>> e0d59e7b5270ae6d2f51bb3f447c22895f8fee54
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error('API handler error', { error: msg })
      res.status(500).json({ error: msg })
    }
  })

<<<<<<< HEAD
  app.get('/api/emotions/:userId', (req: Request, res: Response) => {
    const { userId } = req.params
    const summary = emotionEngine.getEmotionalSummary(userId)
    res.json(summary)
  })

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', version: '1.0.0', emotions: 'active' })
  })

=======
  // ── Health ─────────────────────────────────────────────────────────────────
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', version: '1.0.0' })
  })

  // ── Error handler ──────────────────────────────────────────────────────────
>>>>>>> e0d59e7b5270ae6d2f51bb3f447c22895f8fee54
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error('Unhandled express error', { error: err.message })
    res.status(500).json({ error: 'Internal error' })
  })

  return { app, queue, worker }
}
