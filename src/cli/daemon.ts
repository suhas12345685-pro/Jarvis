/**
 * JARVIS Ghost Daemon — persistent background server.
 *
 * Instead of spawning a fresh Node.js process for every CLI command
 * (which clashes with PM2 and wastes startup time), the daemon runs
 * once, listens on a Unix domain socket, and processes tasks serially.
 *
 * Benefits:
 *   - No process clashing with PM2 (single long-lived process)
 *   - Zero cold-start per task (config, skills, memory already loaded)
 *   - IPC via Unix socket — fast, local-only, no TCP overhead
 *   - Invisible: no browser windows, no terminal output
 *   - Ghost log still works: results → ~/.jarvis/ghost.log
 *
 * Lifecycle:
 *   1. Client sends JSON payload over the socket
 *   2. Daemon reads, routes, executes
 *   3. Result logged to ghost.log
 *   4. Daemon stays alive for next command
 *
 * Socket path: ~/.jarvis/daemon.sock
 */

import { createServer, type Socket } from 'net'
import { existsSync, unlinkSync, mkdirSync } from 'fs'
import { resolve } from 'path'
import { homedir } from 'os'
import { ghostInfo, ghostError, ghostResult } from './ghostLog.js'
import type { GhostPayload } from './taskRouter.js'

const JARVIS_DIR = resolve(homedir(), '.jarvis')
export const SOCKET_PATH = resolve(JARVIS_DIR, 'daemon.sock')

// ── Daemon State ─────────────────────────────────────────────────────────────

let _booted = false
let _config: import('../types/index.js').AppConfig | null = null
let _memory: import('../memoryLayer.js').MemoryLayer | null = null

/**
 * Boot the daemon's heavy dependencies once.
 * Subsequent tasks reuse everything.
 */
async function boot(): Promise<void> {
  if (_booted) return

  ghostInfo('Daemon booting — loading config, skills, memory...')

  // 1. Config
  const { loadConfig } = await import('../config.js')
  try {
    _config = loadConfig()
  } catch (err) {
    ghostError('Daemon boot failed: config error', {
      error: err instanceof Error ? err.message : String(err),
    })
    throw err
  }

  // 2. Skills (self-register on import)
  const { loadAllSkills } = await import('../skills/index.js')
  await loadAllSkills()
  ghostInfo('Skills loaded')

  // 3. Memory layer
  const { createMemoryLayer } = await import('../memoryLayer.js')
  _memory = await createMemoryLayer(_config)
  ghostInfo('Memory layer ready')

  // 4. Learning engine
  try {
    const { initLearningEngine } = await import('../learningEngine.js')
    initLearningEngine(_config, _memory)
    ghostInfo('Learning engine ready')
  } catch {
    ghostInfo('Learning engine skipped (non-fatal)')
  }

  _booted = true
  ghostInfo('Daemon boot complete')
}

// ── Task Execution ───────────────────────────────────────────────────────────

async function handleTask(payload: GhostPayload): Promise<void> {
  ghostInfo('════════════════════════════════════════════════════════════')
  ghostInfo('Task received', { type: payload.type, taskId: payload.taskId })

  try {
    switch (payload.type) {
      case 'web':
        await handleWeb(payload)
        break
      case 'exec':
        await handleExec(payload)
        break
      case 'ai':
        await handleAI(payload)
        break
      default:
        ghostError(`Unknown task type: ${payload.type}`)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    ghostError('Task failed', { taskId: payload.taskId, error: message })
    ghostResult(payload.taskId, `FATAL ERROR: ${message}`)
  }
}

async function handleWeb(payload: GhostPayload): Promise<void> {
  if (!payload.url) {
    ghostError('Web task missing URL')
    return
  }

  const { scrape, extractWithScript, screenshot, closeBrowser } = await import('./webGhost.js')
  try {
    if (payload.screenshotPath) {
      await screenshot(payload.url, payload.screenshotPath)
    } else if (payload.script) {
      await extractWithScript(payload.url, payload.script)
    } else {
      await scrape(payload.url, payload.waitForSelector)
    }
  } finally {
    await closeBrowser()
  }
}

async function handleExec(payload: GhostPayload): Promise<void> {
  if (!payload.command) {
    ghostError('Exec task missing command')
    return
  }

  const { run } = await import('./osExec.js')
  await run(payload.command, payload.cwd)
}

async function handleAI(payload: GhostPayload): Promise<void> {
  if (!payload.prompt) {
    ghostError('AI task missing prompt')
    return
  }

  if (!_config || !_memory) {
    ghostError('Daemon not booted — cannot process AI task')
    ghostResult(payload.taskId, 'DAEMON ERROR: Not booted. Restart the daemon.')
    return
  }

  ghostInfo('AI task: using pre-loaded context')

  // Recall relevant memories
  let ghostMemories: import('../types/index.js').Memory[] = []
  try {
    const results = await _memory.semanticSearch(payload.prompt, 5)
    ghostMemories = results
    if (ghostMemories.length > 0) {
      ghostInfo(`Recalled ${ghostMemories.length} relevant memories`)
    }
  } catch { /* continue without */ }

  // Build context
  const ctx: import('../types/index.js').AgentContext = {
    channelType: 'api',
    userId: `ghost-daemon`,
    threadId: payload.taskId,
    rawMessage: payload.prompt,
    memories: ghostMemories,
    systemPrompt: '',
    byoak: _config.byoak,
    sendInterim: async (msg: string) => {
      ghostInfo(`[interim] ${msg}`)
      return undefined
    },
    sendFinal: async (msg: string) => {
      ghostInfo(`[final] ${msg}`)
    },
  }

  const { runToolLoop } = await import('../toolCaller.js')
  const result = await runToolLoop(ctx, _config)

  ghostInfo('AI task completed')
  ghostResult(payload.taskId, result)
}

// ── Socket Server ────────────────────────────────────────────────────────────

function handleConnection(socket: Socket): void {
  const chunks: Buffer[] = []

  socket.on('data', (chunk: Buffer) => {
    chunks.push(chunk)
  })

  socket.on('end', async () => {
    const raw = Buffer.concat(chunks).toString('utf-8')

    // Protocol: first line = command, rest = payload
    const newline = raw.indexOf('\n')
    const command = newline >= 0 ? raw.slice(0, newline).trim() : raw.trim()
    const body = newline >= 0 ? raw.slice(newline + 1) : ''

    try {
      switch (command) {
        case 'PING': {
          socket.write('PONG\n')
          socket.destroy()
          return
        }

        case 'TASK': {
          const payload = JSON.parse(body) as GhostPayload
          // Acknowledge receipt immediately so the client can exit
          socket.write(`ACK ${payload.taskId}\n`)
          socket.destroy()

          // Execute the task asynchronously (daemon stays alive)
          await handleTask(payload)
          break
        }

        case 'STATUS': {
          const { readRecentResults } = await import('./ghostLog.js')
          socket.write(readRecentResults(5))
          socket.destroy()
          break
        }

        case 'STATUS_FULL': {
          const { readRecent } = await import('./ghostLog.js')
          socket.write(readRecent(100))
          socket.destroy()
          break
        }

        default:
          socket.write(`ERR Unknown command: ${command}\n`)
          socket.destroy()
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      ghostError('Socket handler error', { error: msg })
      try {
        socket.write(`ERR ${msg}\n`)
        socket.destroy()
      } catch { /* socket already closed */ }
    }
  })

  socket.on('error', (err) => {
    ghostError('Socket error', { error: err.message })
  })
}

// ── Start ────────────────────────────────────────────────────────────────────

export async function startDaemon(): Promise<void> {
  // Ensure ~/.jarvis exists
  mkdirSync(JARVIS_DIR, { recursive: true })

  // Clean up stale socket
  if (existsSync(SOCKET_PATH)) {
    try {
      unlinkSync(SOCKET_PATH)
    } catch {
      ghostError('Failed to remove stale socket — another daemon may be running')
      process.exit(1)
    }
  }

  // Boot heavy deps
  await boot()

  // Start listening
  const server = createServer(handleConnection)

  server.listen(SOCKET_PATH, () => {
    ghostInfo(`Daemon listening on ${SOCKET_PATH}`)
  })

  server.on('error', (err) => {
    ghostError('Daemon server error', { error: err.message })
    process.exit(1)
  })

  // Graceful shutdown
  const shutdown = (signal: string) => {
    ghostInfo(`Daemon received ${signal}, shutting down`)
    server.close(() => {
      if (existsSync(SOCKET_PATH)) {
        try { unlinkSync(SOCKET_PATH) } catch { /* best effort */ }
      }
      _memory?.close().catch(() => {})
      ghostInfo('Daemon shut down cleanly')
      process.exit(0)
    })
    setTimeout(() => {
      ghostInfo('Forcing daemon shutdown after timeout')
      process.exit(1)
    }, 10_000)
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('uncaughtException', (err) => {
    ghostError('Daemon uncaught exception', { error: err.message, stack: err.stack })
    process.exit(1)
  })
  process.on('unhandledRejection', (reason) => {
    ghostError('Daemon unhandled rejection', {
      error: reason instanceof Error ? reason.message : String(reason),
    })
  })
}

// If run directly: node dist/cli/daemon.js
startDaemon().catch(err => {
  ghostError('Daemon fatal startup error', {
    error: err instanceof Error ? err.message : String(err),
  })
  process.exit(1)
})
