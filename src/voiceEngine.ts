import Anthropic from '@anthropic-ai/sdk'
import { getLogger } from './logger.js'
import type { AppConfig, AgentContext } from './types/index.js'
import type { MemoryLayer } from './memoryLayer.js'
import { runToolLoop } from './toolCaller.js'

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

  const agent = defineAgent({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    entry: async (ctx: any) => {
      await ctx.connect()
      logger.info('LiveKit agent connected', { room: ctx.room.name })

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
            await agentSession.say(text, { allowInterruptions: true })
          },
        }

        try {
          const result = await runToolLoop(agentCtx, config.anthropicApiKey, activeController.signal)
          await agentCtx.sendFinal(result)
          await memory.insertMemory(
            `Voice user: ${transcript}\nAssistant: ${result}`,
            { userId, channelType: 'voice' }
          )
        } catch (err) {
          if ((err as Error).message !== 'Aborted') {
            logger.error('Voice tool loop error', { error: err })
            await agentSession.say('I encountered an error processing your request.', {})
          }
        } finally {
          activeController = null
        }
      })

      await agentSession.start(ctx.room, session)
    },
  })

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

  // Try Deepgram STT plugin
  try {
    const deepgram = await import('@livekit/agents-plugin-deepgram')
    if (deepgram.STT) {
      logger.info('Loaded Deepgram STT plugin')
      return new deepgram.STT()
    }
  } catch { /* not installed */ }

  // Try Google STT plugin
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

  // Try ElevenLabs TTS plugin
  try {
    const elevenlabs = await import('@livekit/agents-plugin-elevenlabs')
    if (elevenlabs.TTS) {
      logger.info('Loaded ElevenLabs TTS plugin')
      return new elevenlabs.TTS()
    }
  } catch { /* not installed */ }

  // Try Google TTS plugin
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

// ── Stub adapters (used when no plugin is installed) ──────────────────────────

function createStubSTT(): unknown {
  return {
    stream: () => ({
      on: () => {},
      emit: () => {},
      close: () => {},
    }),
  }
}

function createStubTTS(): unknown {
  return {
    synthesize: async () => ({ audio: Buffer.alloc(0) }),
  }
}

// ── LLM adapter that uses Anthropic for real-time voice responses ─────────────

function createJarvisLLM(config: AppConfig): unknown {
  const client = new Anthropic({ apiKey: config.anthropicApiKey })

  return {
    chat: async (opts: { messages: { role: string; content: string }[] }) => {
      const messages = opts.messages
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }))

      // Ensure messages is not empty and starts with user
      if (messages.length === 0) {
        return { choices: [{ message: { role: 'assistant', content: '' } }] }
      }

      try {
        const response = await client.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 1024,
          system: 'You are JARVIS, a voice assistant. Keep responses brief and conversational — they will be spoken aloud.',
          messages,
        })

        const text = response.content
          .filter(b => b.type === 'text')
          .map(b => (b as Anthropic.TextBlock).text)
          .join('\n')

        return { choices: [{ message: { role: 'assistant', content: text } }] }
      } catch (err) {
        getLogger().error('Voice LLM error', { error: err })
        return {
          choices: [{ message: { role: 'assistant', content: 'I had trouble processing that.' } }],
        }
      }
    },
  }
}
