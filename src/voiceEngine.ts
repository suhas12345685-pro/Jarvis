import { getLogger } from './logger.js'
import type { AppConfig, AgentContext } from './types/index.js'
import type { MemoryLayer } from './memoryLayer.js'
import { runToolLoop } from './toolCaller.js'
import { getProvider } from './llm/registry.js'
import { getByoakValue } from './config.js'

const MAX_RECONNECT_ATTEMPTS = 5
const BASE_RECONNECT_DELAY_MS = 2000

/**
 * LiveKit voice pipeline.
 *
 * The @livekit/agents SDK is optional — if not installed, voice is simply
 * disabled and JARVIS continues to operate via Slack/Telegram.
 */
export async function startVoiceEngine(config: AppConfig, memory: MemoryLayer): Promise<void> {
  const logger = getLogger()

  const livekitUrl = config.byoak.find(e => e.service === 'livekit' && e.keyName === 'URL')?.value
  const livekitApiKey = config.byoak.find(e => e.service === 'livekit' && e.keyName === 'API_KEY')?.value
  const livekitSecret = config.byoak.find(e => e.service === 'livekit' && e.keyName === 'API_SECRET')?.value

  if (!livekitUrl || !livekitApiKey || !livekitSecret) {
    logger.info('LiveKit credentials not configured — voice engine disabled')
    return
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let agentsModule: any
  try {
    agentsModule = await import('@livekit/agents')
  } catch {
    logger.warn('@livekit/agents not installed — voice engine disabled. Install with: npm install @livekit/agents')
    return
  }

  const { WorkerOptions, cli, defineAgent, vad } = agentsModule

  let activeController: AbortController | null = null
  let reconnectAttempts = 0

  const agent = defineAgent({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    entry: async (ctx: any) => {
      try {
        await ctx.connect()
        reconnectAttempts = 0 // Reset on successful connection
        logger.info('LiveKit agent connected', { room: ctx.room.name })
      } catch (err) {
        logger.error('LiveKit connection failed', { error: err })
        await attemptReconnect(ctx)
        return
      }

      const session = await ctx.waitForParticipant()
      logger.info('Participant joined', { identity: session.identity })

      // Try to load real STT/TTS plugins, fall back to stubs
      const sttInstance = await loadSTTPlugin() ?? createStubSTT()
      const ttsInstance = await loadTTSPlugin() ?? createStubTTS()

      // Configure the agent session with VAD + STT + LLM + TTS
      const agentSession = new agentsModule.AgentSession({
        stt: sttInstance,
        tts: ttsInstance,
        vad: new vad.SileroVAD({
          minSilenceDuration: 0.8,
          speechPadDuration: 0.2,
        }),
        llm: createJarvisLLM(config),
      })

      // Handle disconnection with reconnect
      ctx.room.on('disconnected', async () => {
        logger.warn('LiveKit room disconnected', { room: ctx.room.name })
        if (activeController) {
          activeController.abort()
          activeController = null
        }
        await attemptReconnect(ctx)
      })

      agentSession.on('user_speech_committed', async (transcript: string) => {
        // Abort any in-progress tool loop
        if (activeController) {
          activeController.abort()
        }
        activeController = new AbortController()

        const memories = await memory.semanticSearch(transcript, 5)
        const userId = session.identity ?? 'voice-user'
        const threadId = ctx.room.name ?? 'voice-session'

        const agentCtx: AgentContext = {
          channelType: 'voice',
          userId,
          threadId,
          rawMessage: transcript,
          memories,
          systemPrompt: memories.length > 0
            ? `Relevant memories:\n${memories.map((m: { content: string }) => `- ${m.content}`).join('\n')}`
            : '',
          byoak: config.byoak,
          sendInterim: async () => undefined,
          sendFinal: async (text: string) => {
            try {
              await agentSession.say(text, { allowInterruptions: true })
            } catch (err) {
              logger.error('TTS output failed', { error: err })
            }
          },
        }

        try {
          const result = await runToolLoop(agentCtx, config, activeController.signal)
          await agentCtx.sendFinal(result)
          await memory.insertMemory(
            `Voice user: ${transcript}\nAssistant: ${result}`,
            { userId, channelType: 'voice' }
          )
        } catch (err) {
          if ((err as Error).message !== 'Aborted') {
            logger.error('Voice tool loop error', { error: err })
            try {
              await agentSession.say('I encountered an error processing your request.', {})
            } catch {
              // TTS failed too — nothing more we can do
            }
          }
        } finally {
          activeController = null
        }
      })

      await agentSession.start(ctx.room, session)
    },
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function attemptReconnect(ctx: any): Promise<void> {
    while (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      reconnectAttempts++
      const delay = BASE_RECONNECT_DELAY_MS * Math.pow(2, reconnectAttempts - 1)
      logger.info('Attempting LiveKit reconnect', { attempt: reconnectAttempts, delayMs: delay })

      await new Promise(r => setTimeout(r, delay))

      try {
        await ctx.connect()
        reconnectAttempts = 0
        logger.info('LiveKit reconnected successfully')
        return
      } catch (err) {
        logger.error('LiveKit reconnect failed', {
          attempt: reconnectAttempts,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
    logger.error('LiveKit max reconnect attempts reached — voice engine stopped')
  }

  cli.runApp(
    new WorkerOptions({
      agent,
      wsURL: livekitUrl,
      apiKey: livekitApiKey,
      apiSecret: livekitSecret,
    })
  )

  logger.info('LiveKit voice engine started', { url: livekitUrl })
}

// ── Plugin loaders ────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadSTTPlugin(): Promise<any | null> {
  const logger = getLogger()

  try {
    const deepgram = await import('@livekit/agents-plugin-deepgram')
    if (deepgram.STT) {
      logger.info('Loaded Deepgram STT plugin')
      return new deepgram.STT()
    }
  } catch { /* not installed */ }

  try {
    const google = await import('@livekit/agents-plugin-google')
    if (google.STT) {
      logger.info('Loaded Google STT plugin')
      return new google.STT()
    }
  } catch { /* not installed */ }

  logger.warn('No STT plugin installed — using stub. Install @livekit/agents-plugin-deepgram for real STT.')
  return null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadTTSPlugin(): Promise<any | null> {
  const logger = getLogger()

  try {
    const elevenlabs = await import('@livekit/agents-plugin-elevenlabs')
    if (elevenlabs.TTS) {
      logger.info('Loaded ElevenLabs TTS plugin')
      return new elevenlabs.TTS()
    }
  } catch { /* not installed */ }

  try {
    const google = await import('@livekit/agents-plugin-google')
    if (google.TTS) {
      logger.info('Loaded Google TTS plugin')
      return new google.TTS()
    }
  } catch { /* not installed */ }

  logger.warn('No TTS plugin installed — using stub. Install @livekit/agents-plugin-elevenlabs for real TTS.')
  return null
}

// ── Stub adapters ─────────────────────────────────────────────────────────────

function createStubSTT(): unknown {
  return {
    stream: () => ({ on: () => {}, emit: () => {}, close: () => {} }),
  }
}

function createStubTTS(): unknown {
  return {
    synthesize: async () => ({ audio: Buffer.alloc(0) }),
  }
}

// ── LLM adapter for voice responses ──────────────────────────────────────────

function createJarvisLLM(config: AppConfig): unknown {
  const apiKey = config.llmProvider === 'anthropic'
    ? config.anthropicApiKey
    : (getByoakValue(config.byoak, config.llmProvider, 'API_KEY') ?? '')

  const provider = getProvider({
    provider: config.llmProvider,
    model: config.llmModel,
    apiKey,
  })

  return {
    chat: async (opts: { messages: { role: string; content: string }[] }) => {
      const messages = opts.messages
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }))

      if (messages.length === 0) {
        return { choices: [{ message: { role: 'assistant', content: '' } }] }
      }

      try {
        const response = await provider.chat({
          model: config.llmModel,
          system: 'You are JARVIS, a voice assistant. Keep responses brief and conversational — they will be spoken aloud.',
          messages,
          maxTokens: 1024,
        })

        return { choices: [{ message: { role: 'assistant', content: response.text } }] }
      } catch (err) {
        getLogger().error('Voice LLM error', { error: err })
        return {
          choices: [{ message: { role: 'assistant', content: 'I had trouble processing that.' } }],
        }
      }
    },
  }
}
