import { registerSkill } from './index.js'
import type { AgentContext, SkillResult } from '../types/index.js'
import {
  registerProactiveTask,
  unregisterProactiveTask,
  listProactiveTasks,
  getProactiveTask,
  type ProactiveTask,
} from '../proactiveEngine.js'
import { randomUUID } from 'crypto'

registerSkill({
  name: 'proactive_create_task',
  description: 'Create a proactive task that JARVIS will execute automatically on a schedule or trigger. JARVIS acts before the user asks.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Task name' },
      description: { type: 'string', description: 'What should JARVIS do' },
      trigger: {
        type: 'string',
        description: 'When to run: "cron:<expression>" (e.g. "cron:0 9 * * *"), "interval:<duration>" (e.g. "interval:30m", "interval:2h")',
      },
      prompt: { type: 'string', description: 'The instruction JARVIS will execute each time' },
      channel: { type: 'string', enum: ['slack', 'telegram', 'discord', 'api'], description: 'Where to deliver results' },
    },
    required: ['name', 'trigger', 'prompt'],
  },
  handler: async (input: Record<string, unknown>, ctx: AgentContext): Promise<SkillResult> => {
    const task: ProactiveTask = {
      id: randomUUID(),
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

    registerProactiveTask(task)
    return {
      output: `Proactive task "${task.name}" created (ID: ${task.id}). Trigger: ${task.trigger}. JARVIS will act autonomously.`,
      isError: false,
    }
  },
})

registerSkill({
  name: 'proactive_list_tasks',
  description: 'List all proactive tasks that JARVIS runs autonomously.',
  inputSchema: { type: 'object', properties: {} },
  handler: async (_input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    const tasks = listProactiveTasks()
    if (tasks.length === 0) {
      return { output: 'No proactive tasks configured.', isError: false }
    }

    const output = tasks.map(t =>
      `• ${t.name} (${t.id})\n  Trigger: ${t.trigger}\n  Enabled: ${t.enabled}\n  Last run: ${t.lastRun?.toISOString() ?? 'never'}`
    ).join('\n\n')

    return { output: `${tasks.length} proactive task(s):\n\n${output}`, isError: false }
  },
})

registerSkill({
  name: 'proactive_toggle_task',
  description: 'Enable or disable a proactive task.',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: 'Task ID' },
      enabled: { type: 'boolean', description: 'Enable (true) or disable (false)' },
    },
    required: ['taskId', 'enabled'],
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    const task = getProactiveTask(String(input.taskId))
    if (!task) return { output: 'Task not found', isError: true }

    task.enabled = Boolean(input.enabled)
    return { output: `Task "${task.name}" ${task.enabled ? 'enabled' : 'disabled'}.`, isError: false }
  },
})

registerSkill({
  name: 'proactive_delete_task',
  description: 'Delete a proactive task.',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: 'Task ID' },
    },
    required: ['taskId'],
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    const removed = unregisterProactiveTask(String(input.taskId))
    return {
      output: removed ? 'Proactive task deleted.' : 'Task not found.',
      isError: !removed,
    }
  },
})
