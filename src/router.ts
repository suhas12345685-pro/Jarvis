import express, { type Request, type Response, type NextFunction } from 'express'
import { EventEmitter } from 'events'
import { createHmac, timingSafeEqual } from 'crypto'
import { Queue, Worker, type Job } from 'bullmq'
import type { AppConfig, AgentContext } from './types/index.js'
import type { MemoryLayer } from './memoryLayer.js'
import { runToolLoop, runStreamingToolLoop } from './toolCaller.js'
import { getLogger } from './logger.js'
import { IPRateLimiter } from './security.js'
import { getEmotionEngine, type EmotionEngine } from './emotionEngine.js'
import { getConsciousness } from './consciousness.js'

export const jarvisEvents = new EventEmitter()

interface AgentJob {
  channelType: AgentContext['channelType']
  userId: string
  threadId: string
  rawMessage: string
  channelPayload: Record<string, unknown>
}

// ── Simple per-user rate limiter ───────────────────────────────────────────────

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
  const ipRateLimiter = new IPRateLimiter(60_000, 100) // 100 req/min per IP
  let emotionEngine: EmotionEngine

  try {
    emotionEngine = getEmotionEngine()
  } catch {
    emotionEngine = getEmotionEngine()
  }

  // ── Queue ─────────────────────────────────────────────────────────────────
  const queue = new Queue<AgentJob>('agent-tasks', {
    connection: { url: config.redisUrl },
  })

  const worker = new Worker<AgentJob>(
    'agent-tasks',
    async (job: Job<AgentJob>) => {
      const { channelType, userId, threadId, rawMessage, channelPayload } = job.data

      // Build channel-specific send functions from payload
      const { sendInterim, sendFinal } = await buildChannelCallbacks(
        channelType, channelPayload, config
      )

      // Consciousness: notice the incoming message
      const consciousness = getConsciousness()
      consciousness.onMessageReceived(userId, rawMessage, channelType)

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

        // Consciousness: reflect on the response
        consciousness.onResponseGenerated(userId, rawMessage, result)

        await sendFinal(emotionalResult.response, ctx.interimMessageId)

        await memory.insertMemory(
          `User: ${rawMessage}\nAssistant: ${result}`,
          { userId, channelType, emotion: emotionState.primary }
        )

        emotionEngine.calibratePersonalityFromInteraction(userId, rawMessage, result)

        jarvisEvents.emit('task:complete', { userId, result: emotionalResult.response, emotion: emotionState.primary })
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

  // Periodic emotion decay
  setInterval(() => {
    emotionEngine.decayEmotions()
  }, 60000)

  // Notify consciousness of queue load changes
  let activeJobCount = 0
  worker.on('active', () => {
    activeJobCount++
    try { getConsciousness().onLoadChange(activeJobCount, 0) } catch { /* not ready */ }
  })
  worker.on('completed', () => {
    activeJobCount = Math.max(0, activeJobCount - 1)
    try { getConsciousness().onLoadChange(activeJobCount, 0) } catch { /* not ready */ }
  })
  worker.on('failed', () => {
    activeJobCount = Math.max(0, activeJobCount - 1)
    try { getConsciousness().onLoadChange(activeJobCount, 0) } catch { /* not ready */ }
  })

  // ── Channel callback builder ────────────────────────────────────────────

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

    // Default for API channel — collect responses via events
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

  // ── Middleware ─────────────────────────────────────────────────────────────
  // Raw body for HMAC, parsed JSON for everything else
  app.use('/webhooks/slack', express.raw({ type: 'application/json' }))
  app.use(express.json({ limit: '1mb' }))

  // IP-based rate limiting for all endpoints
  app.use((req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown'
    if (!ipRateLimiter.isAllowed(ip)) {
      res.status(429).json({ error: 'Too many requests from this IP' })
      return
    }
    next()
  })

  // ── Context Compiler ──────────────────────────────────────────────────────
  // The persona system (src/persona.ts) now handles full system prompt construction,
  // including consciousness state, emotions, memory, and identity injection.
  // compileContext just assembles the raw AgentContext with data.
  async function compileContext(
    channelType: AgentContext['channelType'],
    userId: string,
    threadId: string,
    rawMessage: string,
    sendInterim: AgentContext['sendInterim'],
    sendFinal: AgentContext['sendFinal'],
    emotionState?: ReturnType<EmotionEngine['getOrCreateState']>,
    personality?: ReturnType<EmotionEngine['getPersonality']>
  ): Promise<AgentContext> {
    const memories = await memory.semanticSearch(rawMessage, 5)

    // systemPrompt is now built by buildPersonaPrompt(ctx) in the toolCaller,
    // but we keep a minimal one here for backward compatibility with any
    // code that reads ctx.systemPrompt directly.
    const systemPrompt = `Interaction with ${userId} via ${channelType}.`

    return {
      channelType,
      userId,
      threadId,
      rawMessage,
      memories,
      systemPrompt,
      byoak: config.byoak,
      emotionState,
      personality,
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

    // Rate limit check
    if (!rateLimiter.isAllowed(userId)) {
      res.status(429).json({ error: 'Rate limit exceeded' })
      return
    }

    res.status(200).end()

    // Enqueue the task — worker handles execution
    await queue.add('slack-message', {
      channelType: 'slack',
      userId,
      threadId,
      rawMessage,
      channelPayload: { channel, threadId },
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

    // Rate limit check
    if (!rateLimiter.isAllowed(userId)) {
      res.status(429).json({ error: 'Rate limit exceeded' })
      return
    }

    res.status(200).end()

    // Enqueue the task — worker handles execution
    await queue.add('telegram-message', {
      channelType: 'telegram',
      userId,
      threadId,
      rawMessage,
      channelPayload: { chatId },
    })
  })

  // ── Google Chat Webhook ──────────────────────────────────────────────────
  app.post('/webhooks/gchat', async (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>
    const msgType = body.type as string | undefined

    // Google Chat sends various event types
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
      .replace(/@\S+/g, '')  // Strip bot mentions
      .trim()

    if (!rawMessage) {
      res.status(200).json({})
      return
    }

    if (!rateLimiter.isAllowed(userId)) {
      res.status(200).json({ text: 'Rate limit exceeded. Please wait a moment.' })
      return
    }

    // Respond immediately with acknowledgement (Google Chat expects fast response)
    res.status(200).json({})

    // Enqueue the task
    await queue.add('gchat-message', {
      channelType: 'gchat' as const,
      userId,
      threadId,
      rawMessage,
      channelPayload: { spaceName, threadName: threadId },
    })
  })

  // ── API Endpoint ──────────────────────────────────────────────────────────
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
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error('API handler error', { error: msg })
      res.status(500).json({ error: msg })
    }
  })

  // ── Streaming API Endpoint (SSE) ─────────────────────────────────────────
  app.post('/api/message/stream', async (req: Request, res: Response) => {
    const { userId, message } = req.body as { userId?: string; message?: string }

    if (!userId || !message) {
      res.status(400).json({ error: 'userId and message are required' })
      return
    }

    if (!rateLimiter.isAllowed(userId)) {
      res.status(429).json({ error: 'Rate limit exceeded' })
      return
    }

    // Set up SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    })

    const threadId = `api-stream-${Date.now()}`
    const sendInterim: AgentContext['sendInterim'] = async () => undefined
    const sendFinal: AgentContext['sendFinal'] = async () => {}

    emotionEngine.updateEmotion(userId, message)
    const emotionState = emotionEngine.getOrCreateState(userId)
    const personality = emotionEngine.getPersonality(userId)

    const ctx = await compileContext('api', userId, threadId, message, sendInterim, sendFinal, emotionState, personality)

    const controller = new AbortController()
    req.on('close', () => controller.abort())

    try {
      const result = await runStreamingToolLoop(
        ctx,
        config,
        (delta: string) => {
          res.write(`data: ${JSON.stringify({ type: 'delta', text: delta })}\n\n`)
        },
        controller.signal
      )

      // Send final result
      res.write(`data: ${JSON.stringify({ type: 'done', text: result })}\n\n`)

      await memory.insertMemory(
        `User: ${message}\nAssistant: ${result}`,
        { userId, channelType: 'api', emotion: emotionState.primary }
      )
    } catch (err) {
      if (controller.signal.aborted) return // Client disconnected
      const msg = err instanceof Error ? err.message : String(err)
      logger.error('Streaming API error', { error: msg })
      res.write(`data: ${JSON.stringify({ type: 'error', error: msg })}\n\n`)
    } finally {
      res.end()
    }
  })

  // ── Emotions API ─────────────────────────────────────────────────────────
  app.get('/api/emotions/:userId', (req: Request, res: Response) => {
    const { userId } = req.params
    const summary = emotionEngine.getEmotionalSummary(String(userId))
    res.json(summary)
  })

  // ── Health ─────────────────────────────────────────────────────────────────
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', version: '1.0.0', emotions: 'active' })
  })

  // ── Error handler ──────────────────────────────────────────────────────────
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error('Unhandled express error', { error: err.message })
    res.status(500).json({ error: 'Internal error' })
  })

  return { app, queue, worker }
}
