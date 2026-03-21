import { existsSync } from 'fs'
import { resolve } from 'path'
import { loadConfig } from './config.js'
import { createLogger, registerByoakValues } from './logger.js'
import { createMemoryLayer } from './memoryLayer.js'
import { createEmotionEngine } from './emotionEngine.js'
import { createRouter } from './router.js'
import { startVoiceEngine } from './voiceEngine.js'
import { startDiscordClient } from './channels/discord.js'
import { startTelegramPolling } from './channels/telegram.js'
import { loadAllSkills, getAllDefinitions } from './skills/index.js'
import { createConsciousness } from './consciousness.js'
import { getProvider } from './llm/registry.js'
import { getByoakValue } from './config.js'

const ENV_PATH = resolve(process.cwd(), '.env')

async function main() {
  // Run setup wizard if .env is missing
  if (!existsSync(ENV_PATH)) {
    console.log('No .env file found. Running setup wizard...\n')
    const { execSync } = await import('child_process')
    execSync('npm run setup', { stdio: 'inherit' })
  }

  const config = loadConfig()
  const logger = createLogger(config.logPath)

  // Register BYOAK values with PII scrubber
  registerByoakValues(config.byoak.map(e => e.value))

  logger.info('JARVIS starting', {
    dbMode: config.dbMode,
    port: config.port,
    llmProvider: config.llmProvider,
    llmModel: config.llmModel,
  })

  // Initialize memory layer
  const memory = await createMemoryLayer(config)
  logger.info('Memory layer ready')

  // Initialize emotion engine
  createEmotionEngine()
  logger.info('Emotion engine ready')

  // Load all skill modules
  await loadAllSkills()
  logger.info('Skills loaded')

  // Initialize learning engine (learns from interactions + outcomes)
  const { initLearningEngine } = await import('./learningEngine.js')
  initLearningEngine(config, memory)
  logger.info('Learning engine ready')

  // Initialize persistent schedule store + restore saved schedules
  const { initScheduleStore, restoreSchedules } = await import('./skills/persistentSchedule.js')
  initScheduleStore(memory)
  const restoredCount = await restoreSchedules()
  if (restoredCount > 0) {
    logger.info(`Restored ${restoredCount} persistent schedule(s) from memory`)
  }

  // Initialize consciousness engine
  const consciousness = createConsciousness()
  consciousness.registerSkills(getAllDefinitions().map(s => s.name))

  // Attach LLM provider to consciousness for deep thinking (LangGraph)
  try {
    const apiKey = config.llmProvider === 'anthropic'
      ? config.anthropicApiKey
      : (getByoakValue(config.byoak, config.llmProvider, 'API_KEY') || config.anthropicApiKey)
    const llmProvider = getProvider({
      provider: config.llmProvider,
      model: config.llmModel,
      apiKey,
    })
    consciousness.attachLLM(llmProvider, config.llmModel)
    logger.info('Consciousness LLM thinking enabled', { provider: config.llmProvider, model: config.llmModel })
  } catch (err) {
    logger.warn('Consciousness LLM thinking unavailable, using rule-based fallback', {
      error: err instanceof Error ? err.message : String(err),
    })
  }
  logger.info('Consciousness engine ready')

  // Start HTTP router (handles Slack, Telegram, Google Chat webhooks + API)
  const { app, queue } = createRouter(config, memory)
  const server = app.listen(config.port, () => {
    logger.info(`JARVIS listening on port ${config.port}`)
  })

  // Start Discord client (WebSocket, no-op if not configured)
  await startDiscordClient(config, memory, queue)

  // Start Telegram polling (no-op if not configured or in webhook mode)
  await startTelegramPolling(config, memory, queue)

  // Start voice engine (no-op if LiveKit not configured)
  await startVoiceEngine(config, memory)

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down gracefully`)
    server.close(async () => {
      consciousness.shutdown()
      await memory.close()
      logger.info('JARVIS shut down cleanly')
      process.exit(0)
    })
    setTimeout(() => {
      logger.warn('Forcing shutdown after timeout')
      process.exit(1)
    }, 10000)
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('uncaughtException', err => {
    logger.error('Uncaught exception', { error: err.message, stack: err.stack })
    process.exit(1)
  })
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', { reason })
  })
}

main().catch(err => {
  console.error('Fatal startup error:', err)
  process.exit(1)
})