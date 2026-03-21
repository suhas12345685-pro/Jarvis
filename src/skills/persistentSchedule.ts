/**
 * Persistent Schedule Store
 *
 * Solves the critical gap: schedules/reminders were in-memory only,
 * lost on every restart. This module persists them to the memory layer
 * and restores them on boot.
 *
 * How it works:
 * 1. When a schedule/reminder is created, it's saved to memory with
 *    metadata tag `{ type: 'schedule', ... }`
 * 2. On boot, `restoreSchedules()` queries all schedule memories and
 *    re-registers them with the proactive engine
 * 3. The proactive engine handles the actual cron/interval execution
 * 4. When a schedule is deleted, the memory is also cleaned up
 */

import type { MemoryLayer } from '../memoryLayer.js'
import type { AppConfig } from '../types/index.js'
import type { ProactiveTask } from '../proactiveEngine.js'
import {
  registerProactiveTask,
  unregisterProactiveTask,
  listProactiveTasks,
} from '../proactiveEngine.js'
import { registerSkill } from './index.js'
import type { AgentContext, SkillResult } from '../types/index.js'
import { getLogger } from '../logger.js'
import { randomUUID } from 'crypto'

const logger = getLogger()

// In-memory index: scheduleId → memoryId (for deletion)
const scheduleMemoryMap = new Map<string, string>()

let _memory: MemoryLayer | null = null

/**
 * Initialize the persistent schedule store.
 * Call this after memory layer is ready.
 */
export function initScheduleStore(memory: MemoryLayer): void {
  _memory = memory
}

/**
 * Persist a schedule to the memory layer.
 */
async function persistSchedule(task: ProactiveTask): Promise<void> {
  if (!_memory) return

  const content = `Schedule: "${task.name}" — ${task.description}. Trigger: ${task.trigger}. Prompt: ${task.prompt}`
  const metadata = {
    type: 'schedule',
    scheduleId: task.id,
    name: task.name,
    description: task.description,
    trigger: task.trigger,
    prompt: task.prompt,
    channel: task.channel,
    channelPayload: task.channelPayload,
    userId: task.userId,
    enabled: task.enabled,
    createdAt: task.createdAt.toISOString(),
  }

  const mem = await _memory.insertMemory(content, metadata)
  scheduleMemoryMap.set(task.id, mem.id)
  logger.info('Schedule persisted to memory', { scheduleId: task.id, memoryId: mem.id })
}

/**
 * Remove a schedule from the memory layer.
 */
async function removePersistedSchedule(scheduleId: string): Promise<void> {
  if (!_memory) return

  const memoryId = scheduleMemoryMap.get(scheduleId)
  if (memoryId) {
    await _memory.deleteMemory(memoryId)
    scheduleMemoryMap.delete(scheduleId)
    logger.info('Schedule removed from memory', { scheduleId, memoryId })
  }
}

/**
 * Restore all persisted schedules from the memory layer.
 * Called on boot to bring back schedules that survived a restart.
 */
export async function restoreSchedules(): Promise<number> {
  if (!_memory) return 0

  // Search for schedule memories
  const memories = await _memory.semanticSearch('schedule reminder cron interval task', 100)
  let restored = 0

  for (const mem of memories) {
    const meta = mem.metadata
    if (meta.type !== 'schedule' || !meta.scheduleId || !meta.trigger || !meta.prompt) {
      continue
    }

    // Skip if already registered (e.g., default tasks)
    const existing = listProactiveTasks().find(t => t.id === meta.scheduleId)
    if (existing) continue

    const task: ProactiveTask = {
      id: String(meta.scheduleId),
      name: String(meta.name ?? 'Restored Schedule'),
      description: String(meta.description ?? ''),
      trigger: String(meta.trigger),
      prompt: String(meta.prompt),
      channel: (meta.channel as ProactiveTask['channel']) ?? 'api',
      channelPayload: (meta.channelPayload as Record<string, unknown>) ?? {},
      userId: String(meta.userId ?? 'system'),
      enabled: meta.enabled !== false, // default to enabled
      lastRun: undefined,
      createdAt: meta.createdAt ? new Date(String(meta.createdAt)) : new Date(),
    }

    registerProactiveTask(task)
    scheduleMemoryMap.set(task.id, mem.id)
    restored++

    logger.info('Schedule restored from memory', { id: task.id, name: task.name, trigger: task.trigger })
  }

  if (restored > 0) {
    logger.info(`Restored ${restored} schedule(s) from persistent memory`)
  }

  return restored
}

// ── Skills for persistent scheduling ─────────────────────────────────────────

registerSkill({
  name: 'schedule_create',
  description:
    'Create a persistent schedule that JARVIS remembers across restarts. ' +
    'Use this when the user says "every morning at 9", "remind me daily", ' +
    '"check X every hour", "at 5pm do Y", etc. The schedule survives reboots.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Human-readable schedule name' },
      description: { type: 'string', description: 'What this schedule does' },
      trigger: {
        type: 'string',
        description: 'When to run. Formats: "cron:0 9 * * *" (cron), "interval:30m" (repeat), "interval:2h" (repeat)',
      },
      prompt: {
        type: 'string',
        description: 'The instruction JARVIS executes each time the schedule fires',
      },
      channel: {
        type: 'string',
        enum: ['slack', 'telegram', 'discord', 'api', 'gchat'],
        description: 'Where to deliver results (defaults to current channel)',
      },
    },
    required: ['name', 'trigger', 'prompt'],
  },
  handler: async (input: Record<string, unknown>, ctx: AgentContext): Promise<SkillResult> => {
    const task: ProactiveTask = {
      id: `sched-${randomUUID().slice(0, 8)}`,
      name: String(input.name),
      description: String(input.description ?? input.name),
      trigger: String(input.trigger),
      prompt: String(input.prompt),
      channel: (input.channel as ProactiveTask['channel']) ?? ctx.channelType,
      channelPayload: {},
      userId: ctx.userId,
      enabled: true,
      createdAt: new Date(),
    }

    // Register with proactive engine (starts the timer)
    registerProactiveTask(task)

    // Persist to memory (survives restarts)
    await persistSchedule(task)

    return {
      output: `Schedule "${task.name}" created and persisted!\n` +
        `ID: ${task.id}\n` +
        `Trigger: ${task.trigger}\n` +
        `This schedule will survive restarts — I'll remember it.`,
      isError: false,
      metadata: { scheduleId: task.id },
    }
  },
})

registerSkill({
  name: 'schedule_delete',
  description: 'Delete a persistent schedule. Removes it from both active execution and memory.',
  inputSchema: {
    type: 'object',
    properties: {
      scheduleId: { type: 'string', description: 'ID of the schedule to delete' },
    },
    required: ['scheduleId'],
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    const id = String(input.scheduleId)

    const removed = unregisterProactiveTask(id)
    await removePersistedSchedule(id)

    return {
      output: removed
        ? `Schedule "${id}" deleted from execution and memory.`
        : `Schedule "${id}" not found in active tasks (may have been cleaned from memory).`,
      isError: !removed,
    }
  },
})

registerSkill({
  name: 'schedule_list',
  description: 'List all active schedules, including persistent ones restored from memory.',
  inputSchema: { type: 'object', properties: {} },
  handler: async (_input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    const tasks = listProactiveTasks()
    if (tasks.length === 0) {
      return { output: 'No schedules configured. Create one with schedule_create.', isError: false }
    }

    const lines = tasks.map(t => {
      const persisted = scheduleMemoryMap.has(t.id) ? ' [persistent]' : ' [in-memory]'
      return `• ${t.name} (${t.id})${persisted}\n` +
        `  Trigger: ${t.trigger}\n` +
        `  Enabled: ${t.enabled}\n` +
        `  Last run: ${t.lastRun?.toISOString() ?? 'never'}\n` +
        `  Prompt: ${t.prompt.slice(0, 80)}${t.prompt.length > 80 ? '...' : ''}`
    })

    return {
      output: `${tasks.length} schedule(s):\n\n${lines.join('\n\n')}`,
      isError: false,
    }
  },
})

registerSkill({
  name: 'remember_for_later',
  description:
    'Store something JARVIS should remember permanently. Use this for user preferences, ' +
    'important facts, addresses, favorite foods, work patterns, or anything the user ' +
    'wants JARVIS to know in the future. This is JARVIS\'s long-term memory.',
  inputSchema: {
    type: 'object',
    properties: {
      fact: { type: 'string', description: 'What to remember (e.g., "User\'s birthday is March 15")' },
      category: {
        type: 'string',
        enum: ['preference', 'fact', 'address', 'habit', 'goal', 'person', 'work', 'health', 'other'],
        description: 'Category of this memory',
      },
    },
    required: ['fact'],
  },
  handler: async (input: Record<string, unknown>, ctx: AgentContext): Promise<SkillResult> => {
    if (!_memory) {
      return { output: 'Memory system not initialized.', isError: true }
    }

    const fact = String(input.fact)
    const category = String(input.category ?? 'other')

    await _memory.insertMemory(
      `User fact: ${fact}`,
      {
        type: 'user_fact',
        category,
        userId: ctx.userId,
        learnedAt: new Date().toISOString(),
        source: 'explicit',
      }
    )

    return {
      output: `Got it — I'll remember that: "${fact}"\nThis is stored permanently and I'll use it when relevant.`,
      isError: false,
    }
  },
})
