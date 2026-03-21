/**
 * Task Router — determines what kind of ghost task to execute and dispatches it.
 *
 * Three modes:
 *   web  → headless Playwright scraping (webGhost)
 *   exec → OS command execution (osExec)
 *   ai   → full JARVIS AI reasoning with tool loop
 */

import { ghostInfo, ghostError, ghostResult } from './ghostLog.js'
import { scrape, extractWithScript, screenshot, closeBrowser } from './webGhost.js'
import { run as execRun } from './osExec.js'
import type { AgentContext } from '../types/index.js'
import type { AppConfig } from '../types/index.js'

export interface GhostPayload {
  type: 'web' | 'exec' | 'ai'
  // web mode
  url?: string
  script?: string         // custom JS for extract mode
  screenshotPath?: string // save screenshot to this path
  waitForSelector?: string
  // exec mode
  command?: string
  cwd?: string
  // ai mode
  prompt?: string
  // metadata
  taskId: string
  timestamp: string
}

/**
 * Route and execute a ghost task based on its type.
 */
export async function routeTask(payload: GhostPayload): Promise<void> {
  ghostInfo(`Task routing started`, { type: payload.type, taskId: payload.taskId })

  try {
    switch (payload.type) {
      case 'web':
        await handleWebTask(payload)
        break
      case 'exec':
        await handleExecTask(payload)
        break
      case 'ai':
        await handleAITask(payload)
        break
      default:
        ghostError(`Unknown task type: ${payload.type}`)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    ghostError(`Task failed`, { taskId: payload.taskId, error: message })
    ghostResult(payload.taskId, `FATAL ERROR: ${message}`)
  }
}

async function handleWebTask(payload: GhostPayload): Promise<void> {
  if (!payload.url) {
    ghostError('Web task missing URL')
    return
  }

  try {
    if (payload.screenshotPath) {
      await screenshot(payload.url, payload.screenshotPath)
    } else if (payload.script) {
      await extractWithScript(payload.url, payload.script)
    } else {
      await scrape(payload.url, payload.waitForSelector)
    }
  } finally {
    await closeBrowser()
  }
}

async function handleExecTask(payload: GhostPayload): Promise<void> {
  if (!payload.command) {
    ghostError('Exec task missing command')
    return
  }

  await execRun(payload.command, payload.cwd)
}

async function handleAITask(payload: GhostPayload): Promise<void> {
  if (!payload.prompt) {
    ghostError('AI task missing prompt')
    return
  }

  ghostInfo('AI task: bootstrapping minimal JARVIS context')

  try {
    // Load config (reads .env)
    const { loadConfig } = await import('../config.js')
    let config: AppConfig
    try {
      config = loadConfig()
    } catch (err) {
      ghostError('Failed to load config — run "npm run setup" first', {
        error: err instanceof Error ? err.message : String(err),
      })
      ghostResult(payload.taskId, 'CONFIG ERROR: Run "npm run setup" to configure JARVIS.')
      return
    }

    // Load skills (they self-register on import)
    const { loadAllSkills } = await import('../skills/index.js')
    await loadAllSkills()
    ghostInfo('Skills loaded')

    // Build a synthetic AgentContext for the tool loop
    const ctx: AgentContext = {
      channelType: 'api',
      userId: `ghost-${process.pid}`,
      threadId: payload.taskId,
      rawMessage: payload.prompt,
      memories: [],
      systemPrompt: '',
      byoak: config.byoak,
      sendInterim: async (msg: string) => {
        ghostInfo(`[interim] ${msg}`)
        return undefined
      },
      sendFinal: async (msg: string) => {
        ghostInfo(`[final] ${msg}`)
      },
    }

    // Run the tool loop
    const { runToolLoop } = await import('../toolCaller.js')
    const result = await runToolLoop(ctx, config)

    ghostInfo('AI task completed')
    ghostResult(payload.taskId, result)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    ghostError('AI task failed', { error: message })
    ghostResult(payload.taskId, `AI ERROR: ${message}`)
  }
}
