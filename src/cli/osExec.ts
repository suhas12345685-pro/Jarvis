/**
 * OS Command Execution — Ghost Mode
 *
 * Executes shell commands invisibly in the background worker.
 * Reuses the same destructive-pattern safety checks from src/skills/osTerminal.ts.
 * Longer timeout (60s) since ghost tasks can be larger.
 */

import { exec } from 'child_process'
import { promisify } from 'util'
import { ghostInfo, ghostError, ghostResult } from './ghostLog.js'

const execAsync = promisify(exec)

const MAX_OUTPUT_BYTES = 50 * 1024 // 50KB — more generous for ghost mode
const EXEC_TIMEOUT_MS = 60_000     // 60 seconds

// Same patterns as src/skills/osTerminal.ts — keep in sync
const DESTRUCTIVE_PATTERNS = [
  /\brm\s+(-[a-z]*f[a-z]*\s+|--force\s+).*\//i,
  /\brm\s+-rf\b/i,
  /\bdd\s+if=/i,
  /\bmkfs\b/i,
  /\bformat\s+[a-z]:/i,
  /\bshred\b/i,
  /\bwipefs\b/i,
  /\bfdisk\b/i,
  /\bparted\b/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\binit\s+[0-6]\b/i,
  /\bsystemctl\s+(poweroff|halt|reboot)\b/i,
  /:\(\)\s*\{.*:\|:.*\}/,                          // fork bomb
  /\bcrontab\s+-r\b/i,
  /\biptables\s+(-F|--flush)\b/i,
  />\s*\/dev\/(s|h|n)d[a-z]/i,                     // overwrite disk device
  /\bchmod\s+-R\s+000\b/i,
  /\bchown\s+-R\s+.*\s+\/\b/i,
]

function isDestructive(command: string): boolean {
  return DESTRUCTIVE_PATTERNS.some(p => p.test(command))
}

export interface ExecResult {
  stdout: string
  stderr: string
  exitCode: number
  blocked: boolean
}

/**
 * Execute a shell command silently. Returns stdout/stderr and logs to ghost log.
 */
export async function run(command: string, cwd?: string): Promise<ExecResult> {
  const workingDir = cwd ?? process.env.HOME ?? '~'

  if (!command.trim()) {
    ghostError('Empty command received')
    return { stdout: '', stderr: 'Error: empty command', exitCode: 1, blocked: false }
  }

  if (isDestructive(command)) {
    const msg = `BLOCKED: Destructive command pattern detected: "${command}"`
    ghostError(msg)
    return { stdout: '', stderr: msg, exitCode: 1, blocked: true }
  }

  ghostInfo(`Executing command`, { command, cwd: workingDir })

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: workingDir,
      timeout: EXEC_TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT_BYTES * 2,
      shell: '/bin/bash',
    })

    const truncatedOut = stdout.length > MAX_OUTPUT_BYTES
      ? stdout.slice(0, MAX_OUTPUT_BYTES) + '\n[output truncated]'
      : stdout

    const truncatedErr = stderr.length > MAX_OUTPUT_BYTES
      ? stderr.slice(0, MAX_OUTPUT_BYTES) + '\n[stderr truncated]'
      : stderr

    ghostInfo(`Command completed successfully`, { command })
    ghostResult(`exec:${command.slice(0, 60)}`, truncatedOut || '(no output)')

    return {
      stdout: truncatedOut,
      stderr: truncatedErr,
      exitCode: 0,
      blocked: false,
    }
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string; code?: number }
    const output = [e.stdout, e.stderr, e.message].filter(Boolean).join('\n')

    ghostError(`Command failed`, { command, error: e.message })
    ghostResult(`exec:${command.slice(0, 60)}`, `FAILED:\n${output}`)

    return {
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? e.message ?? 'Command failed',
      exitCode: e.code ?? 1,
      blocked: false,
    }
  }
}
