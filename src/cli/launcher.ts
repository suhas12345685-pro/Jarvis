#!/usr/bin/env node
/**
 * J.A.R.V.I.S. CLI — Lightweight IPC Client
 *
 * This is a thin messenger. It does NOT spawn heavy background processes.
 * Instead, it sends commands to the JARVIS Ghost Daemon over a Unix socket.
 *
 * If the daemon isn't running, it auto-starts it as a detached background
 * process, waits briefly for it to boot, then delivers the command.
 *
 * Usage:
 *   jarvis "do something amazing"           # AI-powered task (default)
 *   jarvis --web https://example.com        # Scrape a URL invisibly
 *   jarvis --exec "ls -la"                  # Execute an OS command
 *   jarvis --status                         # Show recent task results
 *   jarvis --status full                    # Show full ghost log
 *   jarvis --daemon                         # Start daemon in foreground
 *   jarvis --daemon-stop                    # Stop running daemon
 *   jarvis --help                           # Show usage info
 *
 * Results: ~/.jarvis/ghost.log
 */

import { connect, type Socket } from 'net'
import { spawn } from 'child_process'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { existsSync } from 'fs'
import { randomUUID } from 'crypto'
import { homedir } from 'os'
import { readRecent, readRecentResults } from './ghostLog.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const SOCKET_PATH = resolve(homedir(), '.jarvis', 'daemon.sock')
const DAEMON_PATH = resolve(__dirname, 'daemon.js')

// ── Payload ──────────────────────────────────────────────────────────────────

interface GhostPayload {
  type: 'web' | 'exec' | 'ai'
  url?: string
  script?: string
  screenshotPath?: string
  waitForSelector?: string
  command?: string
  cwd?: string
  prompt?: string
  taskId: string
  timestamp: string
}

// ── IPC Client ───────────────────────────────────────────────────────────────

function isDaemonRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    if (!existsSync(SOCKET_PATH)) {
      resolve(false)
      return
    }

    const sock = connect(SOCKET_PATH)
    const timeout = setTimeout(() => {
      sock.destroy()
      resolve(false)
    }, 1000)

    sock.on('connect', () => {
      sock.write('PING\n')
    })

    sock.on('data', (data) => {
      clearTimeout(timeout)
      sock.destroy()
      resolve(data.toString().trim() === 'PONG')
    })

    sock.on('error', () => {
      clearTimeout(timeout)
      sock.destroy()
      resolve(false)
    })
  })
}

function startDaemonProcess(): void {
  const child = spawn('node', [DAEMON_PATH], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env },
  })
  child.unref()
}

async function waitForDaemon(maxWaitMs: number = 8000): Promise<boolean> {
  const start = Date.now()
  const interval = 300
  while (Date.now() - start < maxWaitMs) {
    if (await isDaemonRunning()) return true
    await new Promise(r => setTimeout(r, interval))
  }
  return false
}

function sendToDaemon(command: string, body: string = ''): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = connect(SOCKET_PATH)
    const chunks: Buffer[] = []
    const timeout = setTimeout(() => {
      sock.destroy()
      reject(new Error('Daemon response timeout'))
    }, 5000)

    sock.on('connect', () => {
      const payload = body ? `${command}\n${body}` : command
      sock.end(payload)
    })

    sock.on('data', (chunk) => {
      chunks.push(chunk)
    })

    sock.on('end', () => {
      clearTimeout(timeout)
      resolve(Buffer.concat(chunks).toString('utf-8'))
    })

    sock.on('error', (err) => {
      clearTimeout(timeout)
      reject(err)
    })
  })
}

/**
 * Ensure the daemon is running. If not, start it and wait.
 */
async function ensureDaemon(): Promise<boolean> {
  if (await isDaemonRunning()) return true

  console.log('[JARVIS] Starting daemon...')
  startDaemonProcess()

  const ready = await waitForDaemon()
  if (!ready) {
    console.error('[JARVIS] Daemon failed to start. Check ~/.jarvis/ghost.log')
    return false
  }

  console.log('[JARVIS] Daemon ready.')
  return true
}

// ── Arg Parser ───────────────────────────────────────────────────────────────

function printUsage(): void {
  console.log(`
  ╔══════════════════════════════════════════════════╗
  ║         J.A.R.V.I.S. — Ghost Launcher           ║
  ╠══════════════════════════════════════════════════╣
  ║  Tasks run invisibly via the JARVIS daemon.      ║
  ║  Results are logged to ~/.jarvis/ghost.log       ║
  ╚══════════════════════════════════════════════════╝

  USAGE:
    jarvis "your request here"         AI-powered task (default)
    jarvis --web <url>                 Scrape a URL invisibly
    jarvis --web <url> --script "..."  Run custom JS on a page
    jarvis --web <url> --screenshot /path/to/file.png
    jarvis --exec "command"            Execute a shell command
    jarvis --exec "command" --cwd /path
    jarvis --status                    Show recent task results
    jarvis --status full               Show full recent log
    jarvis --daemon                    Start daemon in foreground
    jarvis --daemon-stop               Stop running daemon
    jarvis --help                      This help message

  EXAMPLES:
    jarvis "summarize my git log from today"
    jarvis --web https://news.ycombinator.com
    jarvis --exec "docker ps"
    jarvis --status
`)
}

type ParseResult = GhostPayload | 'status' | 'status-full' | 'help' | 'daemon' | 'daemon-stop' | null

function parseArgs(argv: string[]): ParseResult {
  if (argv.length === 0) return 'help'

  const taskId = `ghost-${randomUUID().slice(0, 8)}`
  const timestamp = new Date().toISOString()

  if (argv[0] === '--help' || argv[0] === '-h') return 'help'
  if (argv[0] === '--daemon') return 'daemon'
  if (argv[0] === '--daemon-stop') return 'daemon-stop'

  if (argv[0] === '--status' || argv[0] === '-s') {
    return argv[1] === 'full' ? 'status-full' : 'status'
  }

  if (argv[0] === '--web') {
    const url = argv[1]
    if (!url) {
      console.error('[JARVIS] Error: --web requires a URL')
      return null
    }

    const payload: GhostPayload = { type: 'web', url, taskId, timestamp }

    for (let i = 2; i < argv.length; i++) {
      if (argv[i] === '--script' && argv[i + 1]) {
        payload.script = argv[++i]
      } else if (argv[i] === '--screenshot' && argv[i + 1]) {
        payload.screenshotPath = argv[++i]
      } else if (argv[i] === '--wait' && argv[i + 1]) {
        payload.waitForSelector = argv[++i]
      }
    }

    return payload
  }

  if (argv[0] === '--exec') {
    const command = argv[1]
    if (!command) {
      console.error('[JARVIS] Error: --exec requires a command')
      return null
    }

    const payload: GhostPayload = { type: 'exec', command, taskId, timestamp }
    for (let i = 2; i < argv.length; i++) {
      if (argv[i] === '--cwd' && argv[i + 1]) {
        payload.cwd = argv[++i]
      }
    }
    return payload
  }

  if (argv[0] === '--ai') {
    const prompt = argv.slice(1).join(' ')
    if (!prompt) {
      console.error('[JARVIS] Error: --ai requires a prompt')
      return null
    }
    return { type: 'ai', prompt, taskId, timestamp }
  }

  // Default: treat everything as an AI prompt
  const prompt = argv.join(' ')
  return { type: 'ai', prompt, taskId, timestamp }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const result = parseArgs(args)

  if (result === 'help') {
    printUsage()
    process.exit(0)
  }

  if (result === 'daemon') {
    // Start daemon in foreground (for PM2 or direct use)
    const { startDaemon } = await import('./daemon.js')
    await startDaemon()
    return // startDaemon keeps the process alive
  }

  if (result === 'daemon-stop') {
    if (await isDaemonRunning()) {
      try {
        await sendToDaemon('PING')
        // Send SIGTERM via socket path existence check
        const { unlinkSync } = await import('fs')
        // The daemon will see the socket disappear on next check
        // Better: just tell user to kill it
        console.log('[JARVIS] Send SIGTERM to the daemon process to stop it.')
        console.log('[JARVIS] Or: pkill -f "node.*daemon.js"')
      } catch {
        console.log('[JARVIS] Daemon not responding.')
      }
    } else {
      console.log('[JARVIS] No daemon is running.')
    }
    process.exit(0)
  }

  // ── Status (read directly from log file — no daemon needed) ──────────
  if (result === 'status') {
    console.log(readRecentResults(5))
    process.exit(0)
  }

  if (result === 'status-full') {
    console.log(readRecent(100))
    process.exit(0)
  }

  if (result === null) {
    process.exit(1)
  }

  // ── Dispatch task to daemon ──────────────────────────────────────────
  const daemonReady = await ensureDaemon()
  if (!daemonReady) {
    process.exit(1)
  }

  try {
    const response = await sendToDaemon('TASK', JSON.stringify(result))
    const ack = response.trim()

    const typeLabels: Record<string, string> = {
      web: `scraping ${result.url}`,
      exec: `executing: ${result.command?.slice(0, 50)}`,
      ai: `thinking about: ${result.prompt?.slice(0, 50)}`,
    }

    if (ack.startsWith('ACK')) {
      console.log(`[JARVIS] Task dispatched (${result.taskId})`)
      console.log(`[JARVIS] ${typeLabels[result.type] ?? result.type}...`)
      console.log(`[JARVIS] Results → ~/.jarvis/ghost.log`)
      console.log(`[JARVIS] Check status: jarvis --status`)
    } else if (ack.startsWith('ERR')) {
      console.error(`[JARVIS] ${ack}`)
    } else {
      console.log(`[JARVIS] ${ack}`)
    }
  } catch (err) {
    console.error(`[JARVIS] Failed to reach daemon: ${err instanceof Error ? err.message : String(err)}`)
    console.error('[JARVIS] Try: jarvis --daemon (in another terminal or via PM2)')
    process.exit(1)
  }

  process.exit(0)
}

main().catch(err => {
  console.error(`[JARVIS] Fatal: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
