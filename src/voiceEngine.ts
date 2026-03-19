import { getLogger } from './logger.js'
import type { AppConfig, AgentContext } from './types/index.js'
import type { MemoryLayer } from './memoryLayer.js'
import { runToolLoop } from './toolCaller.js'
import { getProvider } from './llm/registry.js'
import { getByoakValue } from './config.js'
<<<<<<< HEAD
import { getEmotionEngine } from './emotionEngine.js'
=======
>>>>>>> e0d59e7b5270ae6d2f51bb3f447c22895f8fee54

const MAX_RECONNECT_ATTEMPTS = 5
const BASE_RECONNECT_DELAY_MS = 2000

<<<<<<< HEAD
=======
/**
 * LiveKit voice pipeline.
 *
 * The @livekit/agents SDK is optional — if not installed, voice is simply
 * disabled and JARVIS continues to operate via Slack/Telegram.
 */
>>>>>>> e0d59e7b5270ae6d2f51bb3f447c22895f8fee54
export async function startVoiceEngine(config: AppConfig, memory: MemoryLayer): Promise<void> {
  const logger = getLogger()

  const livekitUrl = config.byoak.find(e => e.service === 'livekit' && e.keyName === 'URL')?.value
  const livekitApiKey = config.byoak.find(e => e.service === 'livekit' && e.keyName === 'API_KEY')?.value
  const livekitSecret = config.byoak.find(e => e.service === 'livekit' && e.keyName === 'API_SECRET')?.value

  if (!livekitUrl || !livekitApiKey || !livekitSecret) {
    logger.info('LiveKit credentials not configured — voice engine disabled')
    return
  }

<<<<<<< HEAD
  let agentsModule: unknown
=======
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let agentsModule: any
>>>>>>> e0d59e7b5270ae6d2f51bb3f447c22895f8fee54
  try {
    agentsModule = await import('@livekit/agents')
  } catch {
    logger.warn('@livekit/agents not installed — voice engine disabled. Install with: npm install @livekit/agents')
    return
  }

<<<<<<< HEAD
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { WorkerOptions, cli, defineAgent, vad } = agentsModule as any
  const emotionEngine = getEmotionEngine()
=======
  const { WorkerOptions, cli, defineAgent, vad } = agentsModule
>>>>>>> e0d59e7b5270ae6d2f51bb3f447c22895f8fee54

  let activeController: AbortController | null = null
  let reconnectAttempts = 0

  const agent = defineAgent({
<<<<<<< HEAD
    entry: async (ctx: any) => {
      try {
        await ctx.connect()
        reconnectAttempts = 0
=======
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    entry: async (ctx: any) => {
      try {
        await ctx.connect()
        reconnectAttempts = 0 // Reset on successful connection
>>>>>>> e0d59e7b5270ae6d2f51bb3f447c22895f8fee54
        logger.info('LiveKit agent connected', { room: ctx.room.name })
      } catch (err) {
        logger.error('LiveKit connection failed', { error: err })
        await attemptReconnect(ctx)
        return
      }

      const session = await ctx.waitForParticipant()
      logger.info('Participant joined', { identity: session.identity })

<<<<<<< HEAD
      const sttInstance = await loadSTTPlugin() ?? createStubSTT()
      const ttsInstance = await loadTTSPlugin() ?? createStubTTS()

      const agentSession = new (agentsModule as any).AgentSession({
=======
      // Try to load real STT/TTS plugins, fall back to stubs
      const sttInstance = await loadSTTPlugin() ?? createStubSTT()
      const ttsInstance = await loadTTSPlugin() ?? createStubTTS()

      // Configure the agent session with VAD + STT + LLM + TTS
      const agentSession = new agentsModule.AgentSession({
>>>>>>> e0d59e7b5270ae6d2f51bb3f447c22895f8fee54
        stt: sttInstance,
        tts: ttsInstance,
        vad: new vad.SileroVAD({
          minSilenceDuration: 0.8,
          speechPadDuration: 0.2,
        }),
<<<<<<< HEAD
        llm: createJarvisLLM(config, emotionEngine),
      })

=======
        llm: createJarvisLLM(config),
      })

      // Handle disconnection with reconnect
>>>>>>> e0d59e7b5270ae6d2f51bb3f447c22895f8fee54
      ctx.room.on('disconnected', async () => {
        logger.warn('LiveKit room disconnected', { room: ctx.room.name })
        if (activeController) {
          activeController.abort()
          activeController = null
        }
        await attemptReconnect(ctx)
      })

      agentSession.on('user_speech_committed', async (transcript: string) => {
<<<<<<< HEAD
=======
        // Abort any in-progress tool loop
>>>>>>> e0d59e7b5270ae6d2f51bb3f447c22895f8fee54
        if (activeController) {
          activeController.abort()
        }
        activeController = new AbortController()

        const memories = await memory.semanticSearch(transcript, 5)
        const userId = session.identity ?? 'voice-user'
        const threadId = ctx.room.name ?? 'voice-session'

<<<<<<< HEAD
        emotionEngine.updateEmotion(userId, transcript)
        const emotionState = emotionEngine.getOrCreateState(userId)
        const personality = emotionEngine.getPersonality(userId)

        const voiceContext = emotionState
          ? `\n\nEmotion context: Current mood is ${emotionState.mood}. Respond in a ${emotionState.mood === 'excited' || emotionState.mood === 'happy' ? 'enthusiastic and warm' : emotionState.mood === 'sad' || emotionState.mood === 'worried' ? 'gentle and reassuring' : 'friendly'} manner.`
          : ''

=======
>>>>>>> e0d59e7b5270ae6d2f51bb3f447c22895f8fee54
        const agentCtx: AgentContext = {
          channelType: 'voice',
          userId,
          threadId,
          rawMessage: transcript,
          memories,
          systemPrompt: memories.length > 0
<<<<<<< HEAD
            ? `Relevant memories:\n${memories.map((m: { content: string }) => `- ${m.content}`).join('\n')}${voiceContext}`
            : `You are JARVIS, a voice assistant.${voiceContext} Keep responses brief and conversational.`,
          byoak: config.byoak,
          emotionState,
          personality,
=======
            ? `Relevant memories:\n${memories.map((m: { content: string }) => `- ${m.content}`).join('\n')}`
            : '',
          byoak: config.byoak,
>>>>>>> e0d59e7b5270ae6d2f51bb3f447c22895f8fee54
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
<<<<<<< HEAD
          const emotionalResult = emotionEngine.generateEmpatheticResponse(userId, result, emotionState.primary)

          await agentCtx.sendFinal(emotionalResult.response)
          await memory.insertMemory(
            `Voice user: ${transcript}\nAssistant: ${result}`,
            { userId, channelType: 'voice', emotion: emotionState.primary }
          )

          emotionEngine.calibratePersonalityFromInteraction(userId, transcript, result)
        } catch (err) {
          if ((err as Error).name !== 'AbortError') {
=======
          await agentCtx.sendFinal(result)
          await memory.insertMemory(
            `Voice user: ${transcript}\nAssistant: ${result}`,
            { userId, channelType: 'voice' }
          )
        } catch (err) {
          if ((err as Error).message !== 'Aborted') {
>>>>>>> e0d59e7b5270ae6d2f51bb3f447c22895f8fee54
            logger.error('Voice tool loop error', { error: err })
            try {
              await agentSession.say('I encountered an error processing your request.', {})
            } catch {
<<<<<<< HEAD
              // TTS failed
=======
              // TTS failed too — nothing more we can do
>>>>>>> e0d59e7b5270ae6d2f51bb3f447c22895f8fee54
            }
          }
        } finally {
          activeController = null
        }
      })

      await agentSession.start(ctx.room, session)
    },
  })

<<<<<<< HEAD
=======
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
>>>>>>> e0d59e7b5270ae6d2f51bb3f447c22895f8fee54
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

<<<<<<< HEAD
async function loadSTTPlugin(): Promise<unknown | null> {
=======
// ── Plugin loaders ────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadSTTPlugin(): Promise<any | null> {
>>>>>>> e0d59e7b5270ae6d2f51bb3f447c22895f8fee54
  const logger = getLogger()

  try {
    const deepgram = await import('@livekit/agents-plugin-deepgram')
    if (deepgram.STT) {
      logger.info('Loaded Deepgram STT plugin')
      return new deepgram.STT()
    }
<<<<<<< HEAD
  } catch { }
=======
  } catch { /* not installed */ }
>>>>>>> e0d59e7b5270ae6d2f51bb3f447c22895f8fee54

  try {
    const google = await import('@livekit/agents-plugin-google')
    if (google.STT) {
      logger.info('Loaded Google STT plugin')
      return new google.STT()
    }
<<<<<<< HEAD
  } catch { }
=======
  } catch { /* not installed */ }
>>>>>>> e0d59e7b5270ae6d2f51bb3f447c22895f8fee54

  logger.warn('No STT plugin installed — using stub. Install @livekit/agents-plugin-deepgram for real STT.')
  return null
}

<<<<<<< HEAD
async function loadTTSPlugin(): Promise<unknown | null> {
=======
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadTTSPlugin(): Promise<any | null> {
>>>>>>> e0d59e7b5270ae6d2f51bb3f447c22895f8fee54
  const logger = getLogger()

  try {
    const elevenlabs = await import('@livekit/agents-plugin-elevenlabs')
    if (elevenlabs.TTS) {
      logger.info('Loaded ElevenLabs TTS plugin')
      return new elevenlabs.TTS()
    }
<<<<<<< HEAD
  } catch { }

  try {
    const google = import('@livekit/agents-plugin-google')
    if ((await google).TTS) {
      logger.info('Loaded Google TTS plugin')
      return new (await google).TTS()
    }
  } catch { }
=======
  } catch { /* not installed */ }

  try {
    const google = await import('@livekit/agents-plugin-google')
    if (google.TTS) {
      logger.info('Loaded Google TTS plugin')
      return new google.TTS()
    }
  } catch { /* not installed */ }
>>>>>>> e0d59e7b5270ae6d2f51bb3f447c22895f8fee54

  logger.warn('No TTS plugin installed — using stub. Install @livekit/agents-plugin-elevenlabs for real TTS.')
  return null
}

<<<<<<< HEAD
=======
// ── Stub adapters ─────────────────────────────────────────────────────────────

>>>>>>> e0d59e7b5270ae6d2f51bb3f447c22895f8fee54
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

<<<<<<< HEAD
function createJarvisLLM(config: AppConfig, _emotionEngine: ReturnType<typeof getEmotionEngine>): unknown {
=======
// ── LLM adapter for voice responses ──────────────────────────────────────────

function createJarvisLLM(config: AppConfig): unknown {
>>>>>>> e0d59e7b5270ae6d2f51bb3f447c22895f8fee54
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
