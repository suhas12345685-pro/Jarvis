/**
 * Scheduler skills — timezone conversion, reminders, timers.
 */
import { registerSkill } from './index.js'
import type { AgentContext, SkillResult } from '../types/index.js'

// In-memory reminder/timer store
const reminders: Map<string, { message: string; triggerAt: Date; timer: ReturnType<typeof setTimeout>; callback?: () => void }> = new Map()
const timers: Map<string, { label: string; startedAt: Date; duration: number; timer: ReturnType<typeof setTimeout> }> = new Map()

registerSkill({
  name: 'timezone_convert',
  description: 'Convert date/time between timezones. Supports IANA timezone names.',
  inputSchema: {
    type: 'object',
    properties: {
      datetime: { type: 'string', description: 'Date/time string (e.g., "2024-03-15 14:30", "now")' },
      from_tz: { type: 'string', description: 'Source timezone (e.g., "America/New_York", "UTC"). Default: UTC' },
      to_tz: { type: 'string', description: 'Target timezone (e.g., "Asia/Tokyo", "Europe/London")' },
      format: { type: 'string', description: 'Output format: iso, short, long, time_only. Default: iso' },
    },
    required: ['to_tz'],
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    try {
      const fromTz = String(input.from_tz || 'UTC')
      const toTz = String(input.to_tz)
      const format = String(input.format || 'iso')

      let date: Date
      const dtStr = String(input.datetime || 'now')
      if (dtStr === 'now') {
        date = new Date()
      } else {
        // Parse with source timezone context
        date = new Date(dtStr)
        if (isNaN(date.getTime())) {
          return { output: `Invalid date: ${dtStr}`, isError: true }
        }
      }

      const options: Intl.DateTimeFormatOptions = { timeZone: toTz }
      let formatted: string

      switch (format) {
        case 'short':
          options.dateStyle = 'short'
          options.timeStyle = 'short'
          formatted = date.toLocaleString('en-US', options)
          break
        case 'long':
          options.dateStyle = 'full'
          options.timeStyle = 'long'
          formatted = date.toLocaleString('en-US', options)
          break
        case 'time_only':
          options.timeStyle = 'medium'
          formatted = date.toLocaleTimeString('en-US', options)
          break
        default: // iso
          formatted = date.toLocaleString('sv-SE', { ...options, hour12: false }).replace(' ', 'T')
          break
      }

      // Get offset info
      const fromFormatted = date.toLocaleString('en-US', { timeZone: fromTz, timeStyle: 'long', dateStyle: 'medium' })
      const toFormatted = date.toLocaleString('en-US', { timeZone: toTz, timeStyle: 'long', dateStyle: 'medium' })

      return {
        output: JSON.stringify({
          from: { timezone: fromTz, datetime: fromFormatted },
          to: { timezone: toTz, datetime: toFormatted },
          formatted,
        }, null, 2),
        isError: false,
      }
    } catch (err) {
      return { output: `Timezone conversion error: ${(err as Error).message}`, isError: true }
    }
  },
})

registerSkill({
  name: 'reminder_set',
  description: 'Set a reminder that triggers after a specified delay.',
  inputSchema: {
    type: 'object',
    properties: {
      message: { type: 'string', description: 'Reminder message' },
      delay: { type: 'string', description: 'Delay before triggering (e.g., "5m", "1h", "30s", "2h30m")' },
      id: { type: 'string', description: 'Optional unique ID (auto-generated if not provided)' },
    },
    required: ['message', 'delay'],
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    try {
      const message = String(input.message)
      const delay = parseDelay(String(input.delay))
      const id = String(input.id || `reminder_${Date.now()}`)

      if (delay <= 0) {
        return { output: 'Invalid delay. Use formats like "5m", "1h", "30s", "2h30m".', isError: true }
      }

      if (delay > 24 * 60 * 60 * 1000) {
        return { output: 'Maximum delay is 24 hours', isError: true }
      }

      // Cancel existing reminder with same ID
      if (reminders.has(id)) {
        clearTimeout(reminders.get(id)!.timer)
      }

      const triggerAt = new Date(Date.now() + delay)
      const timer = setTimeout(() => {
        reminders.delete(id)
        // The reminder fires — in a real system this would notify via the channel
        console.log(`[REMINDER] ${message}`)
      }, delay)

      reminders.set(id, { message, triggerAt, timer })

      return {
        output: JSON.stringify({
          id,
          message,
          triggersAt: triggerAt.toISOString(),
          delay: String(input.delay),
        }, null, 2),
        isError: false,
      }
    } catch (err) {
      return { output: `Reminder error: ${(err as Error).message}`, isError: true }
    }
  },
})

registerSkill({
  name: 'reminder_list',
  description: 'List all active reminders.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  handler: async (_input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    const active = Array.from(reminders.entries()).map(([id, r]) => ({
      id,
      message: r.message,
      triggersAt: r.triggerAt.toISOString(),
      remainingMs: Math.max(0, r.triggerAt.getTime() - Date.now()),
    }))

    return {
      output: active.length > 0
        ? JSON.stringify(active, null, 2)
        : 'No active reminders',
      isError: false,
    }
  },
})

registerSkill({
  name: 'reminder_cancel',
  description: 'Cancel an active reminder by ID.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Reminder ID to cancel' },
    },
    required: ['id'],
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    const id = String(input.id)
    const reminder = reminders.get(id)
    if (!reminder) {
      return { output: `Reminder "${id}" not found`, isError: true }
    }
    clearTimeout(reminder.timer)
    reminders.delete(id)
    return { output: `Cancelled reminder: ${id}`, isError: false }
  },
})

registerSkill({
  name: 'timer_start',
  description: 'Start a countdown timer.',
  inputSchema: {
    type: 'object',
    properties: {
      label: { type: 'string', description: 'Timer label' },
      duration: { type: 'string', description: 'Duration (e.g., "5m", "1h", "30s")' },
    },
    required: ['label', 'duration'],
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    try {
      const label = String(input.label)
      const durationMs = parseDelay(String(input.duration))
      const id = `timer_${Date.now()}`

      if (durationMs <= 0) {
        return { output: 'Invalid duration', isError: true }
      }

      const timer = setTimeout(() => {
        timers.delete(id)
        console.log(`[TIMER] "${label}" completed`)
      }, durationMs)

      timers.set(id, { label, startedAt: new Date(), duration: durationMs, timer })

      return {
        output: JSON.stringify({
          id,
          label,
          duration: String(input.duration),
          endsAt: new Date(Date.now() + durationMs).toISOString(),
        }, null, 2),
        isError: false,
      }
    } catch (err) {
      return { output: `Timer error: ${(err as Error).message}`, isError: true }
    }
  },
})

function parseDelay(s: string): number {
  let total = 0
  const parts = s.match(/(\d+)\s*(h|m|s|ms)/gi)
  if (!parts) {
    // Try plain number (assume seconds)
    const n = Number(s)
    return isNaN(n) ? 0 : n * 1000
  }
  for (const part of parts) {
    const match = part.match(/(\d+)\s*(h|m|s|ms)/i)
    if (!match) continue
    const val = Number(match[1])
    switch (match[2].toLowerCase()) {
      case 'h': total += val * 3600000; break
      case 'm': total += val * 60000; break
      case 's': total += val * 1000; break
      case 'ms': total += val; break
    }
  }
  return total
}
