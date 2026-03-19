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
import { loadAllSkills } from './skills/index.js'

const ENV_PATH = resolve(process.cwd(), '.env')

async function main() {
  if (!existsSync(ENV_PATH)) {
    console.log('No .env file found. Running setup wizard...\n')
    const { execSync } = await import('child_process')
    execSync('npm run setup', { stdio: 'inherit' })
  }

  const config = loadConfig()
  const logger = createLogger(config.logPath)

  registerByoakValues(config.byoak.map(e => e.value))

  logger.info('JARVIS starting', {
    dbMode: config.dbMode,
    port: config.port,
    llmProvider: config.llmProvider,
    llmModel: config.llmModel,
  })

  const memory = await createMemoryLayer(config)
  logger.info('Memory layer ready')

  createEmotionEngine()
  logger.info('Emotion engine ready')

  await loadAllSkills()
  logger.info('Skills loaded')

  const { app, queue } = createRouter(config, memory)
  const server = app.listen(config.port, () => {
    logger.info(`JARVIS listening on port ${config.port}`)
  })

  await startDiscordClient(config, memory, queue)
  await startTelegramPolling(config, memory, queue)
  await startVoiceEngine(config, memory)

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
