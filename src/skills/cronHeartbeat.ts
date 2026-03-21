import cron from 'node-cron'
import { registerSkill } from './index.js'
import type { AgentContext, SkillResult } from '../types/index.js'
import { getLogger } from '../logger.js'

const jobs = new Map<string, any>()

registerSkill({
  name: 'cron_register',
  description: 'Register a scheduled recurring task. The AI can call this to schedule its own wake-up calls (e.g., check email every morning at 8 AM).',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: 'Unique identifier for this scheduled task' },
      expression: { type: 'string', description: 'Cron expression (e.g. "0 8 * * *" for 8 AM daily)' },
      description: { type: 'string', description: 'Human-readable description of what this task does' },
    },
    required: ['taskId', 'expression'],
  },
  handler: async (input: Record<string, unknown>, ctx: AgentContext): Promise<SkillResult> => {
    const taskId = String(input.taskId)
    const expression = String(input.expression)
    const description = String(input.description ?? taskId)

    if (!cron.validate(expression)) {
      return { output: `Invalid cron expression: "${expression}"`, isError: true }
    }

    // Stop existing job if replacing
    if (jobs.has(taskId)) {
      jobs.get(taskId)!.stop()
      jobs.delete(taskId)
    }

    const task = cron.schedule(expression, async () => {
      getLogger().info('Cron job fired', { taskId, description })
      // Re-trigger the agent with a reminder message
      await ctx.sendFinal(`⏰ Scheduled task reminder: ${description}`)
    })

    jobs.set(taskId, task)
    getLogger().info('Cron job registered', { taskId, expression, description })

    return {
      output: `Scheduled task "${taskId}" registered: ${description} (${expression})`,
      isError: false,
      metadata: { taskId, expression, description },
    }
  },
})

registerSkill({
  name: 'cron_unregister',
  description: 'Cancel and remove a previously registered scheduled task.',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: 'ID of the task to cancel' },
    },
    required: ['taskId'],
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    const taskId = String(input.taskId)
    if (!jobs.has(taskId)) {
      return { output: `No task found with ID "${taskId}"`, isError: true }
    }
    jobs.get(taskId)!.stop()
    jobs.delete(taskId)
    return { output: `Scheduled task "${taskId}" cancelled`, isError: false }
  },
})

registerSkill({
  name: 'cron_list',
  description: 'List all currently registered scheduled tasks.',
  inputSchema: { type: 'object', properties: {}, required: [] },
  handler: async (_input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    if (jobs.size === 0) {
      return { output: 'No scheduled tasks registered', isError: false }
    }
    const list = Array.from(jobs.keys()).join(', ')
    return { output: `Active scheduled tasks: ${list}`, isError: false }
  },
})
