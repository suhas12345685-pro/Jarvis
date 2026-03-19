import { existsSync } from 'fs'
import { resolve } from 'path'
import { loadConfig } from './config.js'
import { createLogger, registerByoakValues } from './logger.js'
import { createMemoryLayer } from './memoryLayer.js'
import { createRouter, jarvisEvents } from './router.js'
import { startVoiceEngine } from './voiceEngine.js'
import { startDiscordClient } from './channels/discord.js'
import { startTelegramPolling } from './channels/telegram.js'
import { loadAllSkills } from './skills/index.js'
import { initProactiveEngine, shutdownProactiveEngine } from './proactiveEngine.js'
import { initMeetingSkills } from './skills/meetingCall.js'

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

  // Initialize meeting engine (provides config/memory to meeting skills)
  initMeetingSkills(config, memory)

  // Load all skill modules (including custom user-built skills)
  await loadAllSkills()
  logger.info('Skills loaded')

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

  // Initialize proactive engine — JARVIS acts before the user asks
  await initProactiveEngine(config, memory, async (task, result) => {
    logger.info('Proactive task result', { taskId: task.id, name: task.name })
    jarvisEvents.emit('proactive:result', { task, result })

    // If the task has a specific channel, attempt to deliver
    if (task.channel === 'slack' && task.channelPayload.channel) {
      try {
        const { WebClient } = await import('@slack/web-api')
        const botToken = config.byoak.find(e => e.service === 'slack' && e.keyName === 'BOT_TOKEN')?.value
        if (botToken) {
          const client = new WebClient(botToken)
          await client.chat.postMessage({
            channel: task.channelPayload.channel as string,
            text: `🤖 *Proactive: ${task.name}*\n\n${result}`,
          })
        }
      } catch (err) {
        logger.error('Failed to deliver proactive result', { error: err })
      }
    }
  })
  logger.info('Proactive engine ready')

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down gracefully`)
    shutdownProactiveEngine()
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
