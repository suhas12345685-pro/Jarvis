/**
 * Task Router — determines what kind of ghost task to execute and dispatches it.
 *
 * Three modes:
 *   web  → headless Playwright scraping (webGhost)
 *   exec → OS command execution (osExec)
 *   ai   → full JARVIS AI reasoning with semantic tool routing
 *
 * The AI mode now uses the semantic skill router to inject only relevant
 * tools into the LLM context, keeping the context window lean.
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

    // Initialize memory layer for AI tasks
    const { createMemoryLayer } = await import('../memoryLayer.js')
    const memory = await createMemoryLayer(config)
    ghostInfo('Memory layer ready')

    // Initialize learning engine so ghost tasks learn from outcomes
    try {
      const { initLearningEngine } = await import('../learningEngine.js')
      initLearningEngine(config, memory)
      ghostInfo('Learning engine ready')
    } catch {
      ghostInfo('Learning engine skipped (non-fatal)')
    }

    // ── Semantic Intent Classification ──────────────────────────────────
    // Classify the user's prompt to determine which skill categories to load.
    // This prevents dumping all 45+ tools into the LLM context.
    const { classifyIntent, summarizeSelection } = await import('../skills/skillCategories.js')
    const categories = classifyIntent(payload.prompt)
    ghostInfo(`Intent classified: ${summarizeSelection(categories)}`)

    // Recall relevant memories for context
    let ghostMemories: import('../types/index.js').Memory[] = []
    try {
      const results = await memory.semanticSearch(payload.prompt, 5)
      ghostMemories = results
      if (ghostMemories.length > 0) {
        ghostInfo(`Recalled ${ghostMemories.length} relevant memories`)
      }
    } catch {
      // Memory search not available or failed — continue without
    }

    // Build a synthetic AgentContext for the tool loop
    const ctx: AgentContext = {
      channelType: 'api',
      userId: `ghost-${process.pid}`,
      threadId: payload.taskId,
      rawMessage: payload.prompt,
      memories: ghostMemories,
      systemPrompt: '',
      byoak: config.byoak,
      skillCategories: categories,
      sendInterim: async (msg: string) => {
        ghostInfo(`[interim] ${msg}`)
        return undefined
      },
      sendFinal: async (msg: string) => {
        ghostInfo(`[final] ${msg}`)
      },
    }

    // Run the tool loop (with semantic routing)
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
