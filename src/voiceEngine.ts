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

  let agentsModule: typeof import('@livekit/agents')
  try {
    agentsModule = await import('@livekit/agents')
  } catch {
    logger.warn('@livekit/agents not installed — voice engine disabled')
    return
  }

  const { WorkerOptions, cli, defineAgent, llm, stt, tts, vad } = agentsModule

  let activeController: AbortController | null = null

  const agent = defineAgent({
    entry: async (ctx: import('@livekit/agents').JobContext) => {
      await ctx.connect()
      logger.info('LiveKit agent connected', { room: ctx.room.name })

      const session = await ctx.waitForParticipant()
      logger.info('Participant joined', { identity: session.identity })

      // Configure the agent session with VAD + STT + LLM + TTS
      const agentSession = new agentsModule.AgentSession({
        stt: new stt.StreamAdapter(
          // Use whatever STT plugin is available — falls back to a stub
          new (stt as unknown as { default: new () => stt.STT }).default?.() ?? createStubSTT()
        ),
        tts: new (tts as unknown as { default: new () => tts.TTS }).default?.() ?? createStubTTS(),
        vad: new vad.SileroVAD({
          minSilenceDuration: 0.8,
          speechPadDuration: 0.2,
        }),
        llm: createJarvisLLM(config, memory),
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
            ? `Relevant memories:\n${memories.map(m => `- ${m.content}`).join('\n')}`
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

// ── Stub adapters (replaced by real plugins in production) ────────────────────

function createStubSTT(): import('@livekit/agents').stt.STT {
  return {
    stream: () => ({ on: () => {}, emit: () => {} }),
  } as unknown as import('@livekit/agents').stt.STT
}

function createStubTTS(): import('@livekit/agents').tts.TTS {
  return {
    synthesize: async () => ({ audio: Buffer.alloc(0) }),
  } as unknown as import('@livekit/agents').tts.TTS
}

function createJarvisLLM(
  config: AppConfig,
  _memory: MemoryLayer
): import('@livekit/agents').llm.LLM {
  // Minimal LLM adapter — the real tool loop runs in runToolLoop()
  // The voice session uses this only for real-time streaming responses
  return {
    chat: async (opts: { messages: { role: string; content: string }[] }) => {
      const lastUser = [...opts.messages].reverse().find(m => m.role === 'user')
      return {
        choices: [{ message: { role: 'assistant', content: lastUser?.content ?? '' } }],
      }
    },
  } as unknown as import('@livekit/agents').llm.LLM
}
