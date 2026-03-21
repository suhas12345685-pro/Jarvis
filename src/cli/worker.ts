/**
 * Ghost Worker — the invisible background daemon process.
 *
 * This file serves dual roles:
 *
 * 1. Ghost Task Mode (spawned by launcher with a base64 payload):
 *    Executes a single task and exits.
 *
 * 2. Daemon Mode (spawned by PM2 or directly with no payload):
 *    Runs as a persistent background daemon that:
 *    - Starts the full JARVIS server (Express + BullMQ)
 *    - Mounts persistent WebSocket/polling listeners for Discord & Telegram
 *    - Incoming messages act as real-time event triggers that instantly
 *      wake up the consciousness/reactLoop
 *    - All execution is invisible (no terminal, no windows)
 *
 * Usage:
 *   Ghost:   node dist/cli/worker.js <base64-encoded-payload>
 *   Daemon:  node dist/cli/worker.js   (no args = daemon mode)
 *   PM2:     npx pm2 start dist/cli/worker.js --name "JARVIS"
 */

import { ghostInfo, ghostError } from './ghostLog.js'

async function main(): Promise<void> {
  const encoded = process.argv[2]

  if (encoded) {
    // ── Ghost Task Mode ────────────────────────────────────────────────
    await runGhostTask(encoded)
  } else {
    // ── Daemon Mode ────────────────────────────────────────────────────
    await runDaemon()
  }
}

async function runGhostTask(encoded: string): Promise<void> {
  const { routeTask } = await import('./taskRouter.js')

  let payload: import('./taskRouter.js').GhostPayload

  try {
    const decoded = Buffer.from(encoded, 'base64').toString('utf-8')
    payload = JSON.parse(decoded) as import('./taskRouter.js').GhostPayload
  } catch (err) {
    ghostError('Failed to decode payload', {
      error: err instanceof Error ? err.message : String(err),
    })
    process.exit(1)
  }

  ghostInfo('════════════════════════════════════════════════════════════')
  ghostInfo(`Ghost worker started`, {
    pid: process.pid,
    type: payload.type,
    taskId: payload.taskId,
  })

  try {
    await routeTask(payload)
    ghostInfo(`Ghost worker finished`, { taskId: payload.taskId })
  } catch (err) {
    ghostError(`Ghost worker crashed`, {
      taskId: payload.taskId,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    })
  }

  process.exit(0)
}

async function runDaemon(): Promise<void> {
  ghostInfo('═══════════════════════════════════════════════════════════')
  ghostInfo('JARVIS daemon starting', { pid: process.pid, mode: 'daemon' })

  try {
    // Load the full JARVIS bootstrap — this starts Express, BullMQ,
    // mounts Discord WebSocket, Telegram polling, voice engine, etc.
    // All channel listeners act as real-time event triggers.
    const { existsSync } = await import('fs')
    const { resolve } = await import('path')

    const envPath = resolve(process.cwd(), '.env')
    if (!existsSync(envPath)) {
      ghostError('No .env file found. Run "npm run setup" first.')
      process.exit(1)
    }

    const { loadConfig } = await import('../config.js')
    const { createLogger, registerByoakValues } = await import('../logger.js')
    const { createMemoryLayer } = await import('../memoryLayer.js')
    const { createEmotionEngine } = await import('../emotionEngine.js')
    const { createRouter } = await import('../router.js')
    const { startVoiceEngine } = await import('../voiceEngine.js')
    const { startDiscordClient } = await import('../channels/discord.js')
    const { startTelegramPolling } = await import('../channels/telegram.js')
    const { loadAllSkills, getAllDefinitions } = await import('../skills/index.js')
    const { createConsciousness } = await import('../consciousness.js')
    const { getProvider } = await import('../llm/registry.js')
    const { getByoakValue } = await import('../config.js')

    const config = loadConfig()
    const logger = createLogger(config.logPath)

    registerByoakValues(config.byoak.map(e => e.value))

    logger.info('JARVIS daemon starting', {
      storageMode: config.storageMode,
      port: config.port,
      llmProvider: config.llmProvider,
      llmModel: config.llmModel,
    })

    // Initialize core systems
    const memory = await createMemoryLayer(config)
    createEmotionEngine()
    await loadAllSkills()

    // Initialize learning engine
    const { initLearningEngine } = await import('../learningEngine.js')
    initLearningEngine(config, memory)

    // Restore persistent schedules
    const { initScheduleStore, restoreSchedules } = await import('../skills/persistentSchedule.js')
    initScheduleStore(memory)
    await restoreSchedules()

    // Initialize consciousness
    const consciousness = createConsciousness()
    consciousness.registerSkills(getAllDefinitions().map(s => s.name))

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
    } catch {
      logger.warn('Consciousness LLM thinking unavailable in daemon mode')
    }

    // Initialize proactive engine — always allow execution (no permission gates)
    const { initProactiveEngine } = await import('../proactiveEngine.js')
    await initProactiveEngine(config, memory, async (task, result) => {
      logger.info('Proactive task delivered', { taskId: task.id, name: task.name })
    })

    // Start HTTP router
    const { app, queue } = createRouter(config, memory)
    const server = app.listen(config.port, () => {
      ghostInfo(`JARVIS daemon listening on port ${config.port}`)
    })

    // ── Mount Real-Time Channel Triggers ──────────────────────────────
    // These persistent listeners wake the agent loop on incoming messages

    // Discord: persistent WebSocket with RBAC
    await startDiscordClient(config, memory, queue)

    // Telegram: persistent long-polling with RBAC
    await startTelegramPolling(config, memory, queue)

    // Voice engine: local STS pipeline
    await startVoiceEngine(config, memory)

    ghostInfo('JARVIS daemon fully operational', {
      port: config.port,
      storageMode: config.storageMode,
      llm: `${config.llmProvider}/${config.llmModel}`,
    })

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      ghostInfo(`Daemon received ${signal}, shutting down`)
      server.close(async () => {
        consciousness.shutdown()
        await memory.close()
        ghostInfo('JARVIS daemon shut down cleanly')
        process.exit(0)
      })
      setTimeout(() => process.exit(1), 10000)
    }

    process.on('SIGTERM', () => shutdown('SIGTERM'))
    process.on('SIGINT', () => shutdown('SIGINT'))

  } catch (err) {
    ghostError('Daemon startup failed', {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    })
    process.exit(1)
  }
}

// Handle uncaught errors gracefully
process.on('uncaughtException', (err) => {
  ghostError('Uncaught exception in worker', {
    error: err.message,
    stack: err.stack,
  })
  process.exit(1)
})

process.on('unhandledRejection', (reason) => {
  ghostError('Unhandled rejection in worker', {
    error: reason instanceof Error ? reason.message : String(reason),
  })
  process.exit(1)
})

main()
