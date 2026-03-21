#!/usr/bin/env node
/**
 * J.A.R.V.I.S. Ghost Launcher — CLI Entry Point
 *
 * The ghost launcher spawns a fully detached background worker and
 * immediately exits, returning control of the terminal to the user.
 * The worker runs invisibly — no browser windows, no terminal output.
 *
 * Usage:
 *   jarvis "do something amazing"           # AI-powered task (default)
 *   jarvis --web https://example.com        # Scrape a URL invisibly
 *   jarvis --exec "ls -la"                  # Execute an OS command
 *   jarvis --status                         # Show recent task results
 *   jarvis --status full                    # Show full ghost log
 *   jarvis --help                           # Show usage info
 *
 * After running: check ~/.jarvis/ghost.log for results.
 *
 * Setup: npm link  (makes 'jarvis' available globally)
 */

import { spawn } from 'child_process'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { randomUUID } from 'crypto'
import { readRecent, readRecentResults } from './ghostLog.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// The worker script lives alongside this file in the dist output
const WORKER_PATH = resolve(__dirname, 'worker.js')

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

function printUsage(): void {
  console.log(`
  ╔══════════════════════════════════════════════════╗
  ║         J.A.R.V.I.S. — Ghost Launcher           ║
  ╠══════════════════════════════════════════════════╣
  ║  Tasks run invisibly in the background.          ║
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
    jarvis --help                      This help message

  EXAMPLES:
    jarvis "summarize my git log from today"
    jarvis --web https://news.ycombinator.com
    jarvis --exec "docker ps"
    jarvis --status
`)
}

function parseArgs(argv: string[]): GhostPayload | 'status' | 'status-full' | 'help' | null {
  if (argv.length === 0) return 'help'

  const taskId = `ghost-${randomUUID().slice(0, 8)}`
  const timestamp = new Date().toISOString()

  // Check for flags
  if (argv[0] === '--help' || argv[0] === '-h') return 'help'

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

    // Check for --script or --screenshot flags
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

function launchGhostWorker(payload: GhostPayload): void {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64')

  const child = spawn('node', [WORKER_PATH, encoded], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env },
  })

  // Fully detach — parent can exit, child keeps running
  child.unref()

  const typeLabels: Record<string, string> = {
    web: `scraping ${payload.url}`,
    exec: `executing: ${payload.command?.slice(0, 50)}`,
    ai: `thinking about: ${payload.prompt?.slice(0, 50)}`,
  }

  console.log(`[JARVIS] Ghost task dispatched (${payload.taskId})`)
  console.log(`[JARVIS] ${typeLabels[payload.type] ?? payload.type}...`)
  console.log(`[JARVIS] Results → ~/.jarvis/ghost.log`)
  console.log(`[JARVIS] Check status: jarvis --status`)
}

// ── Main ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const result = parseArgs(args)

if (result === 'help') {
  printUsage()
  process.exit(0)
}

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

// Launch the ghost worker and exit immediately
launchGhostWorker(result)
process.exit(0)
