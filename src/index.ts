import { existsSync } from 'fs'
import { resolve } from 'path'
import { loadConfig } from './config.js'
import { createLogger, registerByoakValues } from './logger.js'
import { createMemoryLayer } from './memoryLayer.js'
<<<<<<< HEAD
import { createEmotionEngine } from './emotionEngine.js'
=======
>>>>>>> e0d59e7b5270ae6d2f51bb3f447c22895f8fee54
import { createRouter } from './router.js'
import { startVoiceEngine } from './voiceEngine.js'
import { startDiscordClient } from './channels/discord.js'
import { startTelegramPolling } from './channels/telegram.js'
import { loadAllSkills } from './skills/index.js'

const ENV_PATH = resolve(process.cwd(), '.env')

async function main() {
<<<<<<< HEAD
=======
  // Run setup wizard if .env is missing
>>>>>>> e0d59e7b5270ae6d2f51bb3f447c22895f8fee54
  if (!existsSync(ENV_PATH)) {
    console.log('No .env file found. Running setup wizard...\n')
    const { execSync } = await import('child_process')
    execSync('npm run setup', { stdio: 'inherit' })
  }

  const config = loadConfig()
  const logger = createLogger(config.logPath)

<<<<<<< HEAD
=======
  // Register BYOAK values with PII scrubber
>>>>>>> e0d59e7b5270ae6d2f51bb3f447c22895f8fee54
  registerByoakValues(config.byoak.map(e => e.value))

  logger.info('JARVIS starting', {
    dbMode: config.dbMode,
    port: config.port,
    llmProvider: config.llmProvider,
    llmModel: config.llmModel,
  })

<<<<<<< HEAD
  const memory = await createMemoryLayer(config)
  logger.info('Memory layer ready')

  createEmotionEngine()
  logger.info('Emotion engine ready')

  await loadAllSkills()
  logger.info('Skills loaded')

=======
  // Initialize memory layer
  const memory = await createMemoryLayer(config)
  logger.info('Memory layer ready')

  // Load all skill modules
  await loadAllSkills()
  logger.info('Skills loaded')

  // Start HTTP router (handles Slack, Telegram, Google Chat webhooks + API)
>>>>>>> e0d59e7b5270ae6d2f51bb3f447c22895f8fee54
  const { app, queue } = createRouter(config, memory)
  const server = app.listen(config.port, () => {
    logger.info(`JARVIS listening on port ${config.port}`)
  })

<<<<<<< HEAD
  await startDiscordClient(config, memory, queue)
  await startTelegramPolling(config, memory, queue)
  await startVoiceEngine(config, memory)

=======
  // Start Discord client (WebSocket, no-op if not configured)
  await startDiscordClient(config, memory, queue)

  // Start Telegram polling (no-op if not configured or in webhook mode)
  await startTelegramPolling(config, memory, queue)

  // Start voice engine (no-op if LiveKit not configured)
  await startVoiceEngine(config, memory)

  // Graceful shutdown
>>>>>>> e0d59e7b5270ae6d2f51bb3f447c22895f8fee54
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down gracefully`)
    server.close(async () => {
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
