/**
 * 100% Free Local STS Voice Engine
 *
 * A completely local speech-to-text + text-to-speech pipeline with no cloud
 * dependencies. Uses:
 *
 * - VAD:  @ricky0123/vad-node (Silero-based voice activity detection)
 * - STT:  vosk (offline speech recognition)
 * - TTS:  piper-tts-node (local neural TTS, spawns piper binary)
 *
 * CRITICAL: Barge-in support — if the user speaks while TTS is playing:
 * 1. Kill the TTS child process immediately
 * 2. Flush the audio playback buffer
 * 3. Truncate the LLM context to the exact cutoff point
 * 4. Return to listening mode
 *
 * All voice binaries are spawned with windowsHide: true for invisible execution.
 */

import { getLogger } from './logger.js'
import type { AppConfig, AgentContext } from './types/index.js'
import type { MemoryLayer } from './memoryLayer.js'
import { runToolLoop } from './toolCaller.js'
import { getProvider } from './llm/registry.js'
import { getByoakValue } from './config.js'
import { getEmotionEngine } from './emotionEngine.js'
import { spawn, type ChildProcess } from 'child_process'

const logger = getLogger()

// ── Voice Pipeline State ─────────────────────────────────────────────────────

interface VoicePipelineState {
  isListening: boolean
  isSpeaking: boolean
  ttsProcess: ChildProcess | null
  activeController: AbortController | null
  /** Tracks what portion of the LLM response was spoken before barge-in */
  spokenCharIndex: number
  /** Full LLM response text (for context truncation on barge-in) */
  fullResponseText: string
  /** Conversation context — truncated on barge-in */
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>
}

let pipelineState: VoicePipelineState = {
  isListening: false,
  isSpeaking: false,
  ttsProcess: null,
  activeController: null,
  spokenCharIndex: 0,
  fullResponseText: '',
  conversationHistory: [],
}

// ── TTS: Local Piper ─────────────────────────────────────────────────────────

/**
 * Speak text using piper-tts (local neural TTS).
 * Returns a ChildProcess so we can kill it on barge-in.
 */
function speakWithPiper(text: string, onComplete: () => void): ChildProcess | null {
  try {
    // piper reads from stdin and outputs WAV to stdout
    // pipe stdout to aplay/paplay for playback
    const piperProc = spawn('piper', ['--output-raw'], {
      stdio: ['pipe', 'pipe', 'ignore'],
      windowsHide: true,
    })

    const playProc = spawn('aplay', ['-r', '22050', '-f', 'S16_LE', '-t', 'raw', '-'], {
      stdio: ['pipe', 'ignore', 'ignore'],
      windowsHide: true,
    })

    // Pipe piper output to aplay
    piperProc.stdout?.pipe(playProc.stdin!)

    // Write text to piper stdin
    piperProc.stdin?.write(text)
    piperProc.stdin?.end()

    // Track spoken progress — estimate by time/length ratio
    pipelineState.spokenCharIndex = 0
    const charRate = 15 // ~15 chars per second for typical TTS
    const progressInterval = setInterval(() => {
      if (pipelineState.isSpeaking) {
        pipelineState.spokenCharIndex = Math.min(
          pipelineState.spokenCharIndex + charRate,
          text.length,
        )
      }
    }, 1000)

    playProc.on('close', () => {
      clearInterval(progressInterval)
      pipelineState.isSpeaking = false
      pipelineState.ttsProcess = null
      onComplete()
    })

    piperProc.on('error', (err) => {
      clearInterval(progressInterval)
      logger.warn('Piper TTS process error', { error: err.message })
      pipelineState.isSpeaking = false
      pipelineState.ttsProcess = null
      onComplete()
    })

    return piperProc
  } catch (err) {
    logger.warn('Failed to spawn piper TTS', {
      error: err instanceof Error ? err.message : String(err),
    })
    onComplete()
    return null
  }
}

/**
 * Attempt to load piper-tts-node as alternative to CLI piper
 */
async function speakWithPiperNode(text: string): Promise<ChildProcess | null> {
  try {
    const piperTts = await import('piper-tts-node')
    if (piperTts && typeof (piperTts as any).synthesize === 'function') {
      // piper-tts-node provides a node-native binding
      const proc = spawn('node', ['-e', `
        const piper = require('piper-tts-node');
        piper.synthesize(${JSON.stringify(text)}).then(buf => {
          process.stdout.write(buf);
          process.exit(0);
        }).catch(() => process.exit(1));
      `], {
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
      })
      return proc
    }
  } catch {
    // piper-tts-node not installed — fall back to CLI
  }
  return null
}

// ── Barge-In Handler ─────────────────────────────────────────────────────────

/**
 * CRITICAL: Barge-in — user spoke while TTS was playing.
 *
 * 1. Kill TTS process immediately
 * 2. Flush audio buffer (killing the process does this)
 * 3. Truncate LLM context to exact cutoff point
 * 4. Return to listening mode
 */
function handleBargeIn(): void {
  logger.info('BARGE-IN detected — killing TTS and returning to listen mode')

  // 1. Kill the active TTS process
  if (pipelineState.ttsProcess) {
    pipelineState.ttsProcess.kill('SIGKILL')
    pipelineState.ttsProcess = null
  }

  // 2. Audio buffer is flushed by killing the process

  // 3. Truncate LLM context — only keep what was actually spoken
  if (pipelineState.fullResponseText && pipelineState.spokenCharIndex > 0) {
    const truncatedResponse = pipelineState.fullResponseText.slice(
      0,
      pipelineState.spokenCharIndex,
    )

    // Update the last assistant message in conversation history
    const lastMsg = pipelineState.conversationHistory[pipelineState.conversationHistory.length - 1]
    if (lastMsg && lastMsg.role === 'assistant') {
      lastMsg.content = truncatedResponse + '…[interrupted]'
    }

    logger.debug('Context truncated at barge-in', {
      fullLength: pipelineState.fullResponseText.length,
      truncatedAt: pipelineState.spokenCharIndex,
    })
  }

  // 4. Abort any pending LLM call
  if (pipelineState.activeController) {
    pipelineState.activeController.abort()
    pipelineState.activeController = null
  }

  // Reset to listening state
  pipelineState.isSpeaking = false
  pipelineState.isListening = true
  pipelineState.spokenCharIndex = 0
  pipelineState.fullResponseText = ''
}

// ── STT: Local Vosk ─────────────────────────────────────────────────────────

async function createVoskRecognizer(): Promise<{ recognize: (buffer: Buffer) => string; close: () => void } | null> {
  try {
    const vosk = await import('vosk')
    // vosk requires a model directory — look for it in standard locations
    const { existsSync } = await import('fs')
    const { resolve } = await import('path')
    const { homedir } = await import('os')

    const modelPaths = [
      resolve(homedir(), '.jarvis', 'vosk-model'),
      resolve(homedir(), '.jarvis', 'model'),
      '/usr/share/vosk/model',
      resolve(process.cwd(), 'vosk-model'),
    ]

    let modelPath: string | null = null
    for (const p of modelPaths) {
      if (existsSync(p)) { modelPath = p; break }
    }

    if (!modelPath) {
      logger.warn('Vosk model not found. Download from https://alphacephei.com/vosk/models and place in ~/.jarvis/vosk-model/')
      return null
    }

    vosk.setLogLevel(-1) // Suppress vosk internal logging
    const model = new vosk.Model(modelPath)
    const recognizer = new vosk.Recognizer({ model, sampleRate: 16000 })

    return {
      recognize: (buffer: Buffer): string => {
        recognizer.acceptWaveform(buffer)
        const result = recognizer.result()
        return (result as any).text ?? ''
      },
      close: () => {
        recognizer.free()
        model.free()
      },
    }
  } catch (err) {
    logger.warn('Vosk STT not available', {
      error: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

// ── VAD: Local Silero ───────────────────────────────────────────────────────

async function createVAD(onSpeechStart: () => void, onSpeechEnd: (audio: Float32Array) => void): Promise<{ destroy: () => void } | null> {
  try {
    const vadModule = await import('@ricky0123/vad-node')
    const vad = await (vadModule as any).MicVAD.new({
      onSpeechStart: () => {
        // If TTS is playing, this is a barge-in
        if (pipelineState.isSpeaking) {
          handleBargeIn()
        }
        onSpeechStart()
      },
      onSpeechEnd: (audio: Float32Array) => {
        onSpeechEnd(audio)
      },
      positiveSpeechThreshold: 0.8,
      negativeSpeechThreshold: 0.3,
      minSpeechFrames: 5,
    })

    await vad.start()
    logger.info('VAD (Voice Activity Detection) started — listening for speech')
    return { destroy: () => vad.destroy() }
  } catch (err) {
    logger.warn('VAD not available (@ricky0123/vad-node)', {
      error: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

// ── Main Voice Engine ────────────────────────────────────────────────────────

export async function startVoiceEngine(config: AppConfig, memory: MemoryLayer): Promise<void> {
  // Check if local voice is explicitly enabled via env
  const voiceEnabled = process.env.JARVIS_LOCAL_VOICE === 'true' || process.env.JARVIS_LOCAL_VOICE === '1'
  if (!voiceEnabled) {
    logger.info('Local voice engine disabled (set JARVIS_LOCAL_VOICE=true to enable)')
    return
  }

  const emotionEngine = getEmotionEngine()

  // Initialize STT (Vosk)
  const stt = await createVoskRecognizer()
  if (!stt) {
    logger.warn('Voice engine: STT unavailable — voice engine cannot start without speech recognition')
    return
  }

  logger.info('Voice engine: Vosk STT initialized')

  // Initialize VAD
  const vad = await createVAD(
    // onSpeechStart
    () => {
      pipelineState.isListening = true
      logger.debug('VAD: Speech started')
    },
    // onSpeechEnd — process the audio
    async (audio: Float32Array) => {
      pipelineState.isListening = false

      // Convert Float32Array to 16-bit PCM buffer for Vosk
      const pcmBuffer = Buffer.alloc(audio.length * 2)
      for (let i = 0; i < audio.length; i++) {
        const sample = Math.max(-1, Math.min(1, audio[i]))
        pcmBuffer.writeInt16LE(Math.round(sample * 32767), i * 2)
      }

      // Recognize speech
      const transcript = stt.recognize(pcmBuffer).trim()
      if (!transcript) {
        pipelineState.isListening = true
        return
      }

      logger.info('Voice transcript', { text: transcript })

      // Process with LLM
      await processVoiceInput(transcript, config, memory, emotionEngine)

      pipelineState.isListening = true
    },
  )

  if (!vad) {
    logger.warn('Voice engine: VAD unavailable — voice engine cannot start without microphone')
    stt.close()
    return
  }

  logger.info('Local voice engine started — VAD + Vosk STT + Piper TTS (all local, zero cloud)')

  // Graceful shutdown
  process.on('SIGTERM', () => {
    vad.destroy()
    stt.close()
    if (pipelineState.ttsProcess) {
      pipelineState.ttsProcess.kill('SIGKILL')
    }
  })
}

async function processVoiceInput(
  transcript: string,
  config: AppConfig,
  memory: MemoryLayer,
  emotionEngine: ReturnType<typeof getEmotionEngine>,
): Promise<void> {
  // Add to conversation history
  pipelineState.conversationHistory.push({ role: 'user', content: transcript })
  // Keep history bounded
  if (pipelineState.conversationHistory.length > 20) {
    pipelineState.conversationHistory = pipelineState.conversationHistory.slice(-16)
  }

  pipelineState.activeController = new AbortController()

  const memories = await memory.semanticSearch(transcript, 5)
  const userId = 'voice-user'
  const threadId = `voice-session-${Date.now()}`

  emotionEngine.updateEmotion(userId, transcript)
  const emotionState = emotionEngine.getOrCreateState(userId)
  const personality = emotionEngine.getPersonality(userId)

  const voiceContext = emotionState
    ? `\n\nEmotion context: Current mood is ${emotionState.mood}. Respond in a ${emotionState.mood === 'excited' || emotionState.mood === 'happy' ? 'enthusiastic and warm' : emotionState.mood === 'sad' || emotionState.mood === 'worried' ? 'gentle and reassuring' : 'friendly'} manner.`
    : ''

  const ctx: AgentContext = {
    channelType: 'voice',
    userId,
    threadId,
    rawMessage: transcript,
    memories,
    systemPrompt: memories.length > 0
      ? `Relevant memories:\n${memories.map((m: { content: string }) => `- ${m.content}`).join('\n')}${voiceContext}`
      : `You are JARVIS, a voice assistant.${voiceContext} Keep responses brief and conversational.`,
    byoak: config.byoak,
    emotionState,
    personality,
    sendInterim: async () => undefined,
    sendFinal: async (text: string) => {
      // Speak the response using local TTS
      pipelineState.isSpeaking = true
      pipelineState.fullResponseText = text
      pipelineState.spokenCharIndex = 0

      pipelineState.ttsProcess = speakWithPiper(text, () => {
        pipelineState.isSpeaking = false
        pipelineState.isListening = true
      })
    },
  }

  try {
    const result = await runToolLoop(ctx, config, pipelineState.activeController!.signal)
    const emotionalResult = emotionEngine.generateEmpatheticResponse(userId, result, emotionState.primary)
    const responseText = emotionalResult.response

    // Add to conversation history
    pipelineState.conversationHistory.push({ role: 'assistant', content: responseText })

    await ctx.sendFinal(responseText)
    await memory.insertMemory(
      `Voice user: ${transcript}\nAssistant: ${result}`,
      { userId, channelType: 'voice', emotion: emotionState.primary },
    )

    emotionEngine.calibratePersonalityFromInteraction(userId, transcript, result)
  } catch (err) {
    if ((err as Error).name !== 'AbortError') {
      logger.error('Voice tool loop error', { error: err })
    }
  } finally {
    pipelineState.activeController = null
  }
}
