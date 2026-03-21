/**
 * Ghost Logger — silent, append-only file logger for the detached worker.
 *
 * No console output. No Winston. No dependencies beyond Node built-ins.
 * Everything goes to ~/.jarvis/ghost.log so the user can check later
 * with `jarvis --status`.
 */

import { appendFileSync, readFileSync, existsSync, mkdirSync, statSync, renameSync } from 'fs'
import { resolve } from 'path'
import { homedir } from 'os'

const JARVIS_DIR = resolve(homedir(), '.jarvis')
const LOG_FILE = resolve(JARVIS_DIR, 'ghost.log')
const MAX_LOG_SIZE = 5 * 1024 * 1024 // 5MB — rotate when exceeded

// Ensure directory exists
mkdirSync(JARVIS_DIR, { recursive: true })

function rotateIfNeeded(): void {
  try {
    if (existsSync(LOG_FILE) && statSync(LOG_FILE).size > MAX_LOG_SIZE) {
      const backup = resolve(JARVIS_DIR, 'ghost.log.old')
      renameSync(LOG_FILE, backup)
    }
  } catch {
    // Rotation failure is non-fatal
  }
}

function timestamp(): string {
  return new Date().toISOString()
}

function formatEntry(level: string, message: string, meta?: Record<string, unknown>): string {
  const metaStr = meta ? ' ' + JSON.stringify(meta) : ''
  return `[${timestamp()}] [${level.toUpperCase()}] ${message}${metaStr}\n`
}

export function ghostInfo(message: string, meta?: Record<string, unknown>): void {
  rotateIfNeeded()
  appendFileSync(LOG_FILE, formatEntry('INFO', message, meta))
}

export function ghostError(message: string, meta?: Record<string, unknown>): void {
  rotateIfNeeded()
  appendFileSync(LOG_FILE, formatEntry('ERROR', message, meta))
}

export function ghostResult(taskId: string, result: string): void {
  const separator = '═'.repeat(60)
  const entry = `[${timestamp()}] [RESULT] Task: ${taskId}\n${separator}\n${result}\n${separator}\n\n`
  appendFileSync(LOG_FILE, entry)
}

/**
 * Read the last N lines from the ghost log.
 * Used by `jarvis --status` to show recent results.
 */
export function readRecent(lineCount: number = 50): string {
  if (!existsSync(LOG_FILE)) {
    return 'No ghost log found. Run a task first: jarvis "your task here"'
  }

  const content = readFileSync(LOG_FILE, 'utf-8')
  const lines = content.split('\n')

  if (lines.length <= lineCount) {
    return content
  }

  return lines.slice(-lineCount).join('\n')
}

/**
 * Read recent task results only (filters for [RESULT] entries).
 */
export function readRecentResults(count: number = 5): string {
  if (!existsSync(LOG_FILE)) {
    return 'No ghost log found. Run a task first: jarvis "your task here"'
  }

  const content = readFileSync(LOG_FILE, 'utf-8')
  const resultBlocks: string[] = []
  const lines = content.split('\n')
  let currentBlock: string[] = []
  let inResult = false

  for (const line of lines) {
    if (line.includes('[RESULT]')) {
      if (currentBlock.length > 0) {
        resultBlocks.push(currentBlock.join('\n'))
      }
      currentBlock = [line]
      inResult = true
    } else if (inResult) {
      if (line.trim() === '' && currentBlock.length > 2) {
        resultBlocks.push(currentBlock.join('\n'))
        currentBlock = []
        inResult = false
      } else {
        currentBlock.push(line)
      }
    }
  }

  if (currentBlock.length > 0) {
    resultBlocks.push(currentBlock.join('\n'))
  }

  const recent = resultBlocks.slice(-count)
  if (recent.length === 0) {
    return 'No completed tasks found yet.'
  }

  return recent.join('\n\n')
}

export const GHOST_LOG_PATH = LOG_FILE
