/**
 * ReAct (Reason + Act) Execution Loop
 *
 * Autonomous multi-step task execution for JARVIS. Given a complex prompt,
 * the system:
 *
 * 1. **Plan** — TaskGraph decomposes the prompt into ordered sub-tasks,
 *    injecting relevant memories before planning.
 *
 * 2. **Execute** — For each sub-task, runs a Thought → Action → Observation
 *    cycle (the ReAct pattern) until the sub-task is complete or the step
 *    budget is exhausted.
 *
 * 3. **Recover** — When a tool fails, the loop reasons about alternatives
 *    and self-corrects rather than giving up.
 *
 * 4. **Save** — Post-execution, classifies all observations via the
 *    MemoryClassifier and stores them through FederatedMemoryManager.
 *
 * Step budget: 15 total steps across ALL sub-tasks.
 */

import type { LLMProvider } from '../llm/types.js'
import type { AgentContext, AppConfig } from '../types/index.js'
import type { FederatedMemoryManager } from './federatedMemory.js'
import { getSkill } from '../skills/index.js'
import { classifyIntent, getToolsForCategories } from '../skills/skillCategories.js'
import { getLogger } from '../logger.js'
import { classifyBatch } from './memoryClassifier.js'

const logger = getLogger()

// ── Constants ───────────────────────────────────────────────────────────────

const MAX_REACT_STEPS = 15
const MAX_PLAN_RETRIES = 2
const TOOL_TIMEOUT_MS = 30_000

// ── Types ───────────────────────────────────────────────────────────────────

export type SubTaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'

export interface SubTask {
  id: string
  description: string
  dependencies: string[]   // ids of sub-tasks that must complete first
  status: SubTaskStatus
  result?: string
  error?: string
  stepsUsed: number
}

export interface TaskGraph {
  goal: string
  subTasks: SubTask[]
  memoryContext: string    // injected memory before planning
}

export interface ReactStep {
  stepNumber: number
  subTaskId: string
  thought: string
  action?: { tool: string; input: Record<string, unknown> }
  observation?: string
  isError: boolean
}

export interface ReactResult {
  goal: string
  success: boolean
  steps: ReactStep[]
  subTasks: SubTask[]
  finalAnswer: string
  totalStepsUsed: number
  memoriesSaved: number
}

// ── TaskGraph Builder ───────────────────────────────────────────────────────

const PLAN_SYSTEM = `You are JARVIS's task planner. Given a user's goal and relevant memories,
break the goal into ordered sub-tasks.

RULES:
- Each sub-task should be a single, clear action
- Sub-tasks can depend on earlier sub-tasks (reference by id)
- Keep it minimal — prefer fewer steps over more
- If the goal is simple (1 step), return just one sub-task
- Maximum 6 sub-tasks for any goal

CONTEXT FROM MEMORY:
{MEMORY_CONTEXT}

Respond in this EXACT format (one sub-task per block, separated by blank lines):

TASK: <id>
DESCRIPTION: <what to do>
DEPENDS: <comma-separated ids, or NONE>

Example:
TASK: t1
DESCRIPTION: Search the web for recent Node.js security vulnerabilities
DEPENDS: NONE

TASK: t2
DESCRIPTION: Summarize the findings and send via email
DEPENDS: t1`

export async function buildTaskGraph(
  goal: string,
  provider: LLMProvider,
  model: string,
  federatedMemory?: FederatedMemoryManager,
): Promise<TaskGraph> {
  // 1. Query federated memory for relevant context
  let memoryContext = ''
  if (federatedMemory) {
    try {
      memoryContext = await federatedMemory.recallContext(goal, 8)
    } catch {
      // Non-fatal — plan without memory
    }
  }

  // 2. Ask LLM to decompose the goal
  const system = PLAN_SYSTEM.replace('{MEMORY_CONTEXT}', memoryContext || 'No relevant memories found.')

  let retries = 0
  let subTasks: SubTask[] = []

  while (retries <= MAX_PLAN_RETRIES) {
    try {
      const response = await provider.chat({
        model,
        system,
        messages: [{ role: 'user', content: `Goal: ${goal}` }],
        maxTokens: 600,
      })

      subTasks = parsePlan(response.text)
      if (subTasks.length > 0) break
    } catch (err) {
      logger.warn('Task planning failed, retrying', {
        attempt: retries + 1,
        error: err instanceof Error ? err.message : String(err),
      })
    }
    retries++
  }

  // Fallback: single task = the entire goal
  if (subTasks.length === 0) {
    subTasks = [{
      id: 't1',
      description: goal,
      dependencies: [],
      status: 'pending',
      stepsUsed: 0,
    }]
  }

  logger.info('TaskGraph built', { goal, subTaskCount: subTasks.length })
  return { goal, subTasks, memoryContext }
}

function parsePlan(raw: string): SubTask[] {
  const blocks = raw.split(/\n\s*\n/).filter(Boolean)
  const tasks: SubTask[] = []

  for (const block of blocks) {
    const idMatch = block.match(/TASK:\s*(\S+)/i)
    const descMatch = block.match(/DESCRIPTION:\s*(.+)/i)
    const depsMatch = block.match(/DEPENDS:\s*(.+)/i)

    if (!idMatch || !descMatch) continue

    const deps = depsMatch?.[1]?.trim().toUpperCase() === 'NONE'
      ? []
      : (depsMatch?.[1]?.split(',').map(d => d.trim()).filter(Boolean) ?? [])

    tasks.push({
      id: idMatch[1],
      description: descMatch[1].trim(),
      dependencies: deps,
      status: 'pending',
      stepsUsed: 0,
    })
  }

  return tasks
}

// ── ReAct Execution Loop ────────────────────────────────────────────────────

const REACT_SYSTEM = `You are JARVIS executing a task step-by-step using the ReAct pattern.

For each step you must produce EXACTLY this format:

THOUGHT: <your reasoning about what to do next>
ACTION: <tool_name>
INPUT: <valid JSON object for the tool input>

OR if the task is complete:

THOUGHT: <your reasoning>
ANSWER: <final result/summary>

AVAILABLE TOOLS:
{TOOLS}

CURRENT SUB-TASK: {SUBTASK}
GOAL: {GOAL}

Previous steps:
{HISTORY}

RULES:
- Think before acting — reason about what information you need
- If a tool fails, reason about WHY and try an alternative approach
- Never repeat the exact same action that just failed
- When you have enough information, produce an ANSWER
- Be concise in thoughts — focus on what matters`

export async function executeReactLoop(
  taskGraph: TaskGraph,
  provider: LLMProvider,
  model: string,
  ctx: AgentContext,
  config: AppConfig,
  federatedMemory?: FederatedMemoryManager,
): Promise<ReactResult> {
  const steps: ReactStep[] = []
  let totalSteps = 0

  // Resolve available tools based on the goal's intent
  const categories = ctx.skillCategories ?? classifyIntent(taskGraph.goal)
  const tools = getToolsForCategories(categories)
  const toolDescriptions = tools
    .map(t => `- ${t.name}: ${t.description}`)
    .join('\n')

  // Execute sub-tasks in dependency order
  for (const subTask of topologicalOrder(taskGraph.subTasks)) {
    if (totalSteps >= MAX_REACT_STEPS) {
      subTask.status = 'skipped'
      subTask.error = 'Step budget exhausted'
      continue
    }

    // Check dependencies
    const depsFailed = subTask.dependencies.some(depId => {
      const dep = taskGraph.subTasks.find(t => t.id === depId)
      return dep && dep.status === 'failed'
    })

    if (depsFailed) {
      subTask.status = 'skipped'
      subTask.error = 'Dependency failed'
      continue
    }

    subTask.status = 'running'
    logger.info('ReAct: executing sub-task', { id: subTask.id, description: subTask.description })

    const result = await executeSubTask(
      subTask,
      taskGraph,
      provider,
      model,
      ctx,
      toolDescriptions,
      steps,
      totalSteps,
    )

    totalSteps += result.stepsUsed
    subTask.stepsUsed = result.stepsUsed

    if (result.success) {
      subTask.status = 'completed'
      subTask.result = result.answer
    } else {
      subTask.status = 'failed'
      subTask.error = result.answer
    }
  }

  // Determine overall success
  const allCompleted = taskGraph.subTasks.every(
    t => t.status === 'completed' || t.status === 'skipped'
  )
  const anyCompleted = taskGraph.subTasks.some(t => t.status === 'completed')

  // Build final answer from completed sub-tasks
  const completedResults = taskGraph.subTasks
    .filter(t => t.status === 'completed' && t.result)
    .map(t => t.result!)

  const finalAnswer = completedResults.length > 0
    ? completedResults.join('\n\n')
    : 'I was unable to complete this task. ' +
      taskGraph.subTasks.filter(t => t.error).map(t => t.error).join('; ')

  // ── Cognitive Save ──────────────────────────────────────────────────────
  let memoriesSaved = 0
  if (federatedMemory && steps.length > 0) {
    memoriesSaved = await cognitiveSave(steps, taskGraph, provider, model, federatedMemory, ctx.userId)
  }

  return {
    goal: taskGraph.goal,
    success: allCompleted || anyCompleted,
    steps,
    subTasks: taskGraph.subTasks,
    finalAnswer,
    totalStepsUsed: totalSteps,
    memoriesSaved,
  }
}

// ── Sub-task executor ───────────────────────────────────────────────────────

interface SubTaskResult {
  success: boolean
  answer: string
  stepsUsed: number
}

async function executeSubTask(
  subTask: SubTask,
  taskGraph: TaskGraph,
  provider: LLMProvider,
  model: string,
  ctx: AgentContext,
  toolDescriptions: string,
  allSteps: ReactStep[],
  currentTotalSteps: number,
): Promise<SubTaskResult> {
  const history: string[] = []
  let stepsUsed = 0
  const maxStepsForTask = MAX_REACT_STEPS - currentTotalSteps

  // Include results from completed dependencies as context
  const depResults = subTask.dependencies
    .map(depId => {
      const dep = taskGraph.subTasks.find(t => t.id === depId)
      return dep?.result ? `[Result from "${dep.description}"]: ${dep.result}` : null
    })
    .filter(Boolean)
    .join('\n')

  while (stepsUsed < maxStepsForTask) {
    stepsUsed++
    const stepNumber = currentTotalSteps + stepsUsed

    const system = REACT_SYSTEM
      .replace('{TOOLS}', toolDescriptions)
      .replace('{SUBTASK}', subTask.description)
      .replace('{GOAL}', taskGraph.goal)
      .replace('{HISTORY}', history.length > 0
        ? history.join('\n---\n')
        : depResults || 'No previous steps.')

    let response
    try {
      response = await provider.chat({
        model,
        system,
        messages: [{ role: 'user', content: 'Execute the next step.' }],
        maxTokens: 500,
      })
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      logger.error('ReAct LLM call failed', { stepNumber, error: errMsg })

      allSteps.push({
        stepNumber,
        subTaskId: subTask.id,
        thought: `LLM call failed: ${errMsg}`,
        isError: true,
      })
      return { success: false, answer: `LLM error: ${errMsg}`, stepsUsed }
    }

    const parsed = parseReactResponse(response.text)

    // If the LLM produced an ANSWER, we're done with this sub-task
    if (parsed.answer !== undefined) {
      allSteps.push({
        stepNumber,
        subTaskId: subTask.id,
        thought: parsed.thought,
        observation: parsed.answer,
        isError: false,
      })
      history.push(`THOUGHT: ${parsed.thought}\nANSWER: ${parsed.answer}`)
      return { success: true, answer: parsed.answer, stepsUsed }
    }

    // Execute the action
    if (parsed.action) {
      const { tool, input } = parsed.action
      let observation: string
      let isError = false

      try {
        observation = await executeToolSafe(tool, input, ctx)
      } catch (err) {
        observation = `Error: ${err instanceof Error ? err.message : String(err)}`
        isError = true
      }

      const step: ReactStep = {
        stepNumber,
        subTaskId: subTask.id,
        thought: parsed.thought,
        action: { tool, input },
        observation,
        isError,
      }
      allSteps.push(step)

      history.push(
        `THOUGHT: ${parsed.thought}\nACTION: ${tool}\nINPUT: ${JSON.stringify(input)}\nOBSERVATION: ${observation}`
      )

      // Error recovery: if the tool failed, add recovery context
      if (isError) {
        history.push(
          `RECOVERY NOTE: The action "${tool}" failed. Consider an alternative approach or different tool.`
        )
      }
    } else {
      // LLM produced a thought but no action and no answer — nudge it
      allSteps.push({
        stepNumber,
        subTaskId: subTask.id,
        thought: parsed.thought,
        isError: false,
      })
      history.push(`THOUGHT: ${parsed.thought}\n(No action taken — please choose an ACTION or provide an ANSWER)`)
    }
  }

  // Budget exhausted for this sub-task
  return {
    success: false,
    answer: 'Step budget exhausted for this sub-task',
    stepsUsed,
  }
}

// ── Parse ReAct response ────────────────────────────────────────────────────

interface ParsedReact {
  thought: string
  action?: { tool: string; input: Record<string, unknown> }
  answer?: string
}

function parseReactResponse(raw: string): ParsedReact {
  const thoughtMatch = raw.match(/THOUGHT:\s*(.+?)(?=\nACTION:|ANSWER:|$)/is)
  const actionMatch = raw.match(/ACTION:\s*(\S+)/i)
  const inputMatch = raw.match(/INPUT:\s*(\{[\s\S]*?\})\s*$/im)
  const answerMatch = raw.match(/ANSWER:\s*([\s\S]+)$/i)

  const thought = thoughtMatch?.[1]?.trim() ?? raw.trim()

  if (answerMatch) {
    return { thought, answer: answerMatch[1].trim() }
  }

  if (actionMatch) {
    let input: Record<string, unknown> = {}
    if (inputMatch) {
      try {
        input = JSON.parse(inputMatch[1])
      } catch {
        // If JSON parse fails, try to extract key-value pairs
        input = { raw: inputMatch[1] }
      }
    }
    return { thought, action: { tool: actionMatch[1].trim(), input } }
  }

  return { thought }
}

// ── Safe tool execution ─────────────────────────────────────────────────────

async function executeToolSafe(
  toolName: string,
  input: Record<string, unknown>,
  ctx: AgentContext,
): Promise<string> {
  const skill = getSkill(toolName)
  if (!skill) {
    throw new Error(`Unknown tool: ${toolName}`)
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), TOOL_TIMEOUT_MS)

  try {
    const result = await Promise.race([
      skill.handler(input, ctx),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () => {
          reject(new Error(`Tool "${toolName}" timed out after ${TOOL_TIMEOUT_MS}ms`))
        })
      }),
    ])
    return result.output
  } finally {
    clearTimeout(timeoutId)
    controller.abort()
  }
}

// ── Topological sort ────────────────────────────────────────────────────────

function topologicalOrder(tasks: SubTask[]): SubTask[] {
  const taskMap = new Map(tasks.map(t => [t.id, t]))
  const visited = new Set<string>()
  const result: SubTask[] = []

  function visit(id: string): void {
    if (visited.has(id)) return
    visited.add(id)

    const task = taskMap.get(id)
    if (!task) return

    for (const depId of task.dependencies) {
      visit(depId)
    }
    result.push(task)
  }

  for (const task of tasks) {
    visit(task.id)
  }

  return result
}

// ── Cognitive Save ──────────────────────────────────────────────────────────

/**
 * Post-execution: classify all observations from the ReAct loop and
 * store them as long-term memories via FederatedMemoryManager.
 */
async function cognitiveSave(
  steps: ReactStep[],
  taskGraph: TaskGraph,
  provider: LLMProvider,
  model: string,
  federatedMemory: FederatedMemoryManager,
  userId: string,
): Promise<number> {
  // Collect meaningful observations (skip errors and empty)
  const observations = steps
    .filter(s => s.observation && !s.isError && s.observation.length > 20)
    .map(s => s.observation!)

  // Also save the overall task result
  const completedTasks = taskGraph.subTasks
    .filter(t => t.status === 'completed' && t.result)
    .map(t => `Task "${t.description}": ${t.result!.slice(0, 300)}`)

  const allContent = [...observations, ...completedTasks]
  if (allContent.length === 0) return 0

  // Deduplicate similar content
  const unique = deduplicateStrings(allContent)

  try {
    // Classify in batch
    const classified = await classifyBatch(unique, provider, model)

    // Store each classified memory
    let saved = 0
    for (const mem of classified) {
      // Skip low-importance observations
      if (mem.importance < 0.3) continue

      await federatedMemory.storeDirect(mem, userId, {
        source: 'react_loop',
        goal: taskGraph.goal,
        savedAt: new Date().toISOString(),
      })
      saved++
    }

    logger.info('Cognitive save complete', { total: allContent.length, saved })
    return saved
  } catch (err) {
    logger.warn('Cognitive save failed (non-fatal)', {
      error: err instanceof Error ? err.message : String(err),
    })
    return 0
  }
}

function deduplicateStrings(arr: string[]): string[] {
  const seen = new Set<string>()
  return arr.filter(s => {
    const key = s.slice(0, 80).toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// ── Convenience entry point ─────────────────────────────────────────────────

/**
 * Full ReAct pipeline: plan → execute → save.
 *
 * This is the main entry point for autonomous multi-step task execution.
 */
export async function runReactPipeline(
  goal: string,
  provider: LLMProvider,
  model: string,
  ctx: AgentContext,
  config: AppConfig,
  federatedMemory?: FederatedMemoryManager,
): Promise<ReactResult> {
  logger.info('ReAct pipeline starting', { goal, userId: ctx.userId })

  // 1. Build task graph (with memory injection)
  const taskGraph = await buildTaskGraph(goal, provider, model, federatedMemory)

  // 2. Execute the ReAct loop
  const result = await executeReactLoop(
    taskGraph,
    provider,
    model,
    ctx,
    config,
    federatedMemory,
  )

  logger.info('ReAct pipeline complete', {
    goal,
    success: result.success,
    totalSteps: result.totalStepsUsed,
    memoriesSaved: result.memoriesSaved,
  })

  return result
}
