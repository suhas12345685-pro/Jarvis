import { existsSync } from 'fs'
import { resolve } from 'path'
import { loadConfig } from './config.js'
import { createLogger, registerByoakValues } from './logger.js'
import { createMemoryLayer } from './memoryLayer.js'
import { createRouter } from './router.js'
import { startVoiceEngine } from './voiceEngine.js'
import { loadAllSkills } from './skills/index.js'

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

  logger.info('JARVIS starting', { dbMode: config.dbMode, port: config.port })

  // Initialize memory layer
  const memory = await createMemoryLayer(config)
  logger.info('Memory layer ready')

  // Load all skill modules
  await loadAllSkills()
  logger.info('Skills loaded')

  // Start HTTP router
  const { app } = createRouter(config, memory)
  const server = app.listen(config.port, () => {
    logger.info(`JARVIS listening on port ${config.port}`)
  })

  // Start voice engine (no-op if LiveKit not configured)
  await startVoiceEngine(config, memory)

  // Graceful shutdown
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
