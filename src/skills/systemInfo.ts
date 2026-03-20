import { registerSkill } from './index.js'
import type { AgentContext, SkillResult } from '../types/index.js'
import { execSync } from 'child_process'
import { hostname, cpus, totalmem, freemem, uptime, platform, release, arch, networkInterfaces } from 'os'

registerSkill({
  name: 'system_info',
  description: 'Get detailed system information: OS, CPU, memory, disk, network.',
  inputSchema: { type: 'object', properties: {} },
  handler: async (_input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    const cpu = cpus()
    const totalMem = totalmem()
    const freeMem = freemem()
    const usedMem = totalMem - freeMem

    let diskInfo = ''
    try {
      diskInfo = execSync('df -h / 2>/dev/null || echo "N/A"', { timeout: 5000 }).toString().trim()
    } catch { diskInfo = 'N/A' }

    const nets = networkInterfaces()
    const ips = Object.entries(nets)
      .flatMap(([name, addrs]) =>
        (addrs ?? []).filter(a => !a.internal && a.family === 'IPv4').map(a => `${name}: ${a.address}`)
      )

    const output = [
      `Hostname: ${hostname()}`,
      `Platform: ${platform()} ${release()} (${arch()})`,
      `CPU: ${cpu[0]?.model ?? 'unknown'} (${cpu.length} cores)`,
      `Memory: ${formatBytes(usedMem)} / ${formatBytes(totalMem)} (${((usedMem / totalMem) * 100).toFixed(1)}% used)`,
      `Uptime: ${formatDuration(uptime())}`,
      `Network: ${ips.join(', ') || 'No external interfaces'}`,
      `\nDisk:\n${diskInfo}`,
    ].join('\n')

    return { output, isError: false }
  },
})

registerSkill({
  name: 'system_processes',
  description: 'List top processes by CPU or memory usage.',
  inputSchema: {
    type: 'object',
    properties: {
      sortBy: { type: 'string', enum: ['cpu', 'memory'], description: 'Sort by CPU or memory (default: cpu)' },
      limit: { type: 'number', description: 'Number of processes to show (default: 10)' },
    },
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    const sortBy = String(input.sortBy ?? 'cpu')
    const limit = Number(input.limit ?? 10)
    const sortFlag = sortBy === 'memory' ? '--sort=-%mem' : '--sort=-%cpu'

    try {
      const output = execSync(
        `ps aux ${sortFlag} 2>/dev/null | head -${limit + 1}`,
        { timeout: 5000 }
      ).toString().trim()
      return { output, isError: false }
    } catch (err) {
      return { output: `Failed to list processes: ${(err as Error).message}`, isError: true }
    }
  },
})

registerSkill({
  name: 'system_env_get',
  description: 'Get the value of an environment variable (non-sensitive ones only).',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Environment variable name' },
    },
    required: ['name'],
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    const name = String(input.name)

    // Block sensitive env vars
    const blocked = ['KEY', 'SECRET', 'TOKEN', 'PASSWORD', 'PASS', 'CREDENTIAL']
    if (blocked.some(b => name.toUpperCase().includes(b))) {
      return { output: `BLOCKED: Cannot read sensitive environment variable "${name}"`, isError: true }
    }

    const value = process.env[name]
    if (value === undefined) {
      return { output: `Environment variable "${name}" is not set`, isError: false }
    }

    return { output: `${name}=${value}`, isError: false }
  },
})

registerSkill({
  name: 'system_date_time',
  description: 'Get current date and time in various timezones.',
  inputSchema: {
    type: 'object',
    properties: {
      timezone: { type: 'string', description: 'IANA timezone (e.g., "America/New_York", "Europe/London", "Asia/Tokyo"). Default: system timezone.' },
      format: { type: 'string', enum: ['iso', 'human', 'unix'], description: 'Output format (default: human)' },
    },
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    const tz = input.timezone as string | undefined
    const format = String(input.format ?? 'human')
    const now = new Date()

    try {
      switch (format) {
        case 'iso':
          return { output: tz ? now.toLocaleString('sv-SE', { timeZone: tz }).replace(' ', 'T') + 'Z' : now.toISOString(), isError: false }
        case 'unix':
          return { output: String(Math.floor(now.getTime() / 1000)), isError: false }
        default: {
          const options: Intl.DateTimeFormatOptions = {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            timeZoneName: 'short',
            ...(tz ? { timeZone: tz } : {}),
          }
          return { output: now.toLocaleString('en-US', options), isError: false }
        }
      }
    } catch (err) {
      return { output: `Date error: ${(err as Error).message}`, isError: true }
    }
  },
})

registerSkill({
  name: 'system_sleep',
  description: 'Wait for a specified duration (useful in multi-step automation).',
  inputSchema: {
    type: 'object',
    properties: {
      seconds: { type: 'number', description: 'Number of seconds to wait (max: 60)' },
    },
    required: ['seconds'],
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    const seconds = Math.min(Number(input.seconds), 60)
    if (seconds <= 0) return { output: 'Duration must be positive', isError: true }
    await new Promise(r => setTimeout(r, seconds * 1000))
    return { output: `Waited ${seconds} seconds.`, isError: false }
  },
})

function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let val = bytes
  while (val >= 1024 && i < units.length - 1) { val /= 1024; i++ }
  return `${val.toFixed(1)} ${units[i]}`
}

function formatDuration(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const parts = []
  if (d > 0) parts.push(`${d}d`)
  if (h > 0) parts.push(`${h}h`)
  parts.push(`${m}m`)
  return parts.join(' ')
}
