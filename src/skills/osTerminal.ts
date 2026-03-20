import { exec } from 'child_process'
import { promisify } from 'util'
import { registerSkill } from './index.js'
import type { AgentContext, SkillResult } from '../types/index.js'
import { getLogger } from '../logger.js'

const execAsync = promisify(exec)

const MAX_OUTPUT_BYTES = 10 * 1024 // 10KB

const DESTRUCTIVE_PATTERNS = [
  /\brm\s+(-[a-z]*f[a-z]*\s+|--force\s+).*\//i,   // rm -rf / or variants
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

async function handler(
  input: Record<string, unknown>,
  _ctx: AgentContext
): Promise<SkillResult> {
  const command = String(input.command ?? '')
  const workingDir = String(input.workingDir ?? process.env.HOME ?? '~')

  if (!command.trim()) {
    return { output: 'Error: command is required', isError: true }
  }

  if (isDestructive(command)) {
    const msg = `BLOCKED: Command contains a potentially destructive pattern: "${command}"`
    getLogger().warn('Destructive command blocked', { command })
    return { output: msg, isError: true }
  }

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: workingDir,
      timeout: 30_000,
      maxBuffer: MAX_OUTPUT_BYTES * 2,
      shell: '/bin/bash',
    })

    const combined = [stdout, stderr].filter(Boolean).join('\n--- STDERR ---\n')
    const truncated = combined.length > MAX_OUTPUT_BYTES
      ? combined.slice(0, MAX_OUTPUT_BYTES) + '\n[output truncated]'
      : combined

    return { output: truncated || '(no output)', isError: false }
  } catch (err) {
    let payload = {}
    if (err instanceof Error) {
      payload = Object.getOwnPropertyNames(err).reduce((acc, key) => {
        acc[key] = (err as any)[key]
        return acc
      }, {} as Record<string, any>)
    } else {
      payload = { error: String(err) }
    }

    return { output: JSON.stringify(payload), isError: true }
  }
}

registerSkill({
  name: 'os_terminal',
  description: 'Execute a shell command on the local machine and return stdout/stderr. Destructive commands (rm -rf, mkfs, shutdown, etc.) are automatically blocked.',
  inputSchema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The shell command to run' },
      workingDir: { type: 'string', description: 'Working directory (default: $HOME)' },
    },
    required: ['command'],
  },
  handler,
})
