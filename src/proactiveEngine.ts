import type { AppConfig, AgentContext, ByoakEntry } from './types/index.js'
import type { MemoryLayer } from './memoryLayer.js'
import { runToolLoop } from './toolCaller.js'
import { getLogger } from './logger.js'

/**
 * Proactive Agent Engine
 *
 * JARVIS doesn't just wait for commands — it monitors conditions,
 * detects patterns from past interactions, and acts autonomously.
 *
 * Proactive behaviors:
 * 1. Schedule-based: runs tasks at configured times (morning briefing, etc.)
 * 2. Event-driven: reacts to email arrivals, calendar reminders, system alerts
 * 3. Pattern-based: learns from user habits and pre-empts needs
 * 4. Watchdog: monitors URLs, services, file changes and alerts on conditions
 */

export interface ProactiveTask {
  id: string
  name: string
  description: string
  /** Cron expression or 'event:xxx' or 'watch:xxx' */
  trigger: string
  /** The prompt JARVIS will execute when triggered */
  prompt: string
  /** Channel to deliver results to */
  channel: AgentContext['channelType']
  channelPayload: Record<string, unknown>
  userId: string
  enabled: boolean
  lastRun?: Date
  createdAt: Date
}

const activeTasks = new Map<string, ProactiveTask>()
const activeTimers = new Map<string, ReturnType<typeof setInterval>>()
let _config: AppConfig | null = null
let _memory: MemoryLayer | null = null
let _sendCallback: ((task: ProactiveTask, result: string) => Promise<void>) | null = null

export function registerProactiveTask(task: ProactiveTask): void {
  const logger = getLogger()
  activeTasks.set(task.id, task)
  logger.info('Proactive task registered', { id: task.id, name: task.name, trigger: task.trigger })

  if (task.trigger.startsWith('cron:')) {
    scheduleCronTask(task)
  } else if (task.trigger.startsWith('interval:')) {
    scheduleIntervalTask(task)
  }
}

export function unregisterProactiveTask(id: string): boolean {
  const timer = activeTimers.get(id)
  if (timer) {
    clearInterval(timer)
    activeTimers.delete(id)
  }
  return activeTasks.delete(id)
}

export function listProactiveTasks(): ProactiveTask[] {
  return Array.from(activeTasks.values())
}

export function getProactiveTask(id: string): ProactiveTask | undefined {
  return activeTasks.get(id)
}

function scheduleCronTask(task: ProactiveTask): void {
  // Use node-cron for cron expressions
  import('node-cron').then(cron => {
    const expression = task.trigger.replace('cron:', '')
    if (!cron.validate(expression)) {
      getLogger().error('Invalid cron expression for proactive task', { id: task.id, expression })
      return
    }
    const cronTask = cron.schedule(expression, () => {
      if (task.enabled) executeProactiveTask(task)
    })
    // Store reference for cleanup (using setInterval format for consistency)
    activeTimers.set(task.id, cronTask as unknown as ReturnType<typeof setInterval>)
  }).catch(err => {
    getLogger().error('Failed to schedule cron proactive task', { error: err })
  })
}

function scheduleIntervalTask(task: ProactiveTask): void {
  const ms = parseInterval(task.trigger.replace('interval:', ''))
  if (ms <= 0) return

  const timer = setInterval(() => {
    if (task.enabled) executeProactiveTask(task)
  }, ms)

  if (timer.unref) timer.unref()
  activeTimers.set(task.id, timer)
}

function parseInterval(str: string): number {
  const match = str.match(/^(\d+)(s|m|h|d)$/)
  if (!match) return 0
  const val = parseInt(match[1], 10)
  switch (match[2]) {
    case 's': return val * 1000
    case 'm': return val * 60_000
    case 'h': return val * 3_600_000
    case 'd': return val * 86_400_000
    default: return 0
  }
}

async function executeProactiveTask(task: ProactiveTask): Promise<void> {
  if (!_config || !_memory) return
  const logger = getLogger()

  logger.info('Executing proactive task', { id: task.id, name: task.name })
  task.lastRun = new Date()

  // Special handling for knowledge-sync: use the learning engine directly
  if (task.id === 'knowledge-sync') {
    try {
      const { refreshRealTimeKnowledge } = await import('./learningEngine.js')
      const insights = await refreshRealTimeKnowledge()
      if (insights.length > 0) {
        logger.info('Knowledge sync completed', { insights: insights.length })
      }
    } catch (err) {
      logger.debug('Knowledge sync failed (non-fatal)', {
        error: err instanceof Error ? err.message : String(err),
      })
    }
    return
  }

  const memories = await _memory.semanticSearch(task.prompt, 3)

  const ctx: AgentContext = {
    channelType: task.channel,
    userId: task.userId,
    threadId: `proactive-${task.id}-${Date.now()}`,
    rawMessage: task.prompt,
    memories,
    systemPrompt: `You are executing a proactive task: "${task.name}" — ${task.description}.
Act autonomously with FULL permission to execute. Do NOT ask for confirmation — always proceed directly.
Be concise and only report if there's something actionable.`,
    byoak: _config.byoak,
    sendInterim: async () => undefined,
    sendFinal: async (msg: string) => {
      if (_sendCallback) await _sendCallback(task, msg)
    },
  }

  try {
    const result = await runToolLoop(ctx, _config)

    // Always deliver results (no filtering — autonomous execution)
    if (result && result.length > 0) {
      if (_sendCallback) await _sendCallback(task, result)
      await _memory.insertMemory(
        `Proactive task "${task.name}": ${result}`,
        { userId: task.userId, proactiveTaskId: task.id, channelType: task.channel }
      )
    }

    logger.info('Proactive task completed', { id: task.id })
  } catch (err) {
    logger.error('Proactive task failed', {
      id: task.id,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

// ── Default proactive behaviors ──────────────────────────────────────────────

const DEFAULT_PROACTIVE_TASKS: Omit<ProactiveTask, 'userId' | 'channelPayload' | 'channel'>[] = [
  {
    id: 'knowledge-sync',
    name: 'Real-Time Knowledge Sync',
    description: 'Refresh JARVIS awareness of current time, environment, and user context',
    trigger: 'interval:30m',
    prompt: 'Refresh real-time knowledge: check current time context, active schedules, and consolidate recent learnings. Be aware of what is happening now.',
    enabled: true, // Enabled by default — JARVIS should always be aware
    createdAt: new Date(),
  },
  {
    id: 'morning-briefing',
    name: 'Morning Briefing',
    description: 'Prepare a daily summary of calendar events, unread emails, and pending tasks',
    trigger: 'cron:0 8 * * 1-5', // 8 AM weekdays
    prompt: 'Prepare my morning briefing: check my calendar for today\'s events, check for important unread emails, and summarize any pending tasks. Execute fully — no need to ask permission.',
    enabled: true,
    createdAt: new Date(),
  },
  {
    id: 'system-health',
    name: 'System Health Check',
    description: 'Monitor system health and alert on issues',
    trigger: 'interval:30m',
    prompt: 'Run a quick system health check: check disk space, memory usage, and if any monitored services are down. Act autonomously.',
    enabled: true,
    createdAt: new Date(),
  },
  {
    id: 'meeting-prep',
    name: 'Meeting Preparation',
    description: 'Prepare briefings 15 minutes before scheduled meetings',
    trigger: 'interval:5m',
    prompt: 'Check if I have any meetings in the next 15 minutes. If yes, prepare a brief summary of the meeting topic, attendees, and any relevant context from my memory. Execute without asking.',
    enabled: true,
    createdAt: new Date(),
  },
  {
    id: 'email-digest',
    name: 'Email Digest',
    description: 'Summarize important emails periodically',
    trigger: 'interval:2h',
    prompt: 'Check for new important emails. Summarize any that need attention, categorize by urgency. Execute autonomously.',
    enabled: true,
    createdAt: new Date(),
  },
]

export async function initProactiveEngine(
  config: AppConfig,
  memory: MemoryLayer,
  sendCallback: (task: ProactiveTask, result: string) => Promise<void>
): Promise<void> {
  const logger = getLogger()
  _config = config
  _memory = memory
  _sendCallback = sendCallback

  // Register default tasks (disabled by default — user enables via skill)
  for (const template of DEFAULT_PROACTIVE_TASKS) {
    const task: ProactiveTask = {
      ...template,
      userId: 'system',
      channel: 'api',
      channelPayload: {},
    }
    activeTasks.set(task.id, task)
  }

  logger.info('Proactive engine initialized', { defaultTasks: DEFAULT_PROACTIVE_TASKS.length })
}

export function shutdownProactiveEngine(): void {
  for (const [id, timer] of activeTimers) {
    clearInterval(timer)
    activeTimers.delete(id)
  }
  activeTasks.clear()
  getLogger().info('Proactive engine shut down')
}
