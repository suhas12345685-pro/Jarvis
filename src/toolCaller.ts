import type { AgentContext, AppConfig } from './types/index.js'
import type { LLMMessage, LLMToolDefinition, LLMStreamEvent } from './llm/types.js'
import { getProvider } from './llm/registry.js'
import { getAllDefinitions } from './skills/index.js'
import { getSkill } from './skills/index.js'
import { getLogger } from './logger.js'
import { getByoakValue } from './config.js'
import { autoGenerateSkill } from './autoSkillGenerator.js'
import { getConsciousness } from './consciousness.js'
import { buildPersonaPrompt } from './persona.js'
import { checkProactiveCare } from './skills/proactiveCare.js'

const FEEDBACK_DELAY_MS = 2000
const MAX_TOOL_ROUNDS = 10
const TOOL_TIMEOUT_MS = 30_000

function toLLMTools(): LLMToolDefinition[] {
  return getAllDefinitions().map(skill => ({
    name: skill.name,
    description: skill.description,
    inputSchema: skill.inputSchema,
  }))
}

export async function withSkillStatusUpdate<T>(
  skillPromise: Promise<T>,
  ctx: AgentContext,
  toolName: string
): Promise<T> {
  let timerId: NodeJS.Timeout | undefined
  const timeoutPromise = new Promise<{ isTimeout: true }>((resolve) => {
    timerId = setTimeout(() => {
      resolve({ isTimeout: true })
    }, 2000)
  })

  const wrappedSkillPromise = skillPromise.then((result) => {
    return { isTimeout: false, result }
  })

  try {
    const raceResult = await Promise.race([wrappedSkillPromise, timeoutPromise])

    if (raceResult.isTimeout) {
      const { jarvisEvents } = await import('./router.js')
      jarvisEvents.emit('status_update', {
        userId: ctx.userId,
        threadId: ctx.threadId,
        tool: toolName,
        message: `Still executing ${toolName}...`
      })

      // Return the original promise to allow it to continue executing in the background
      return await skillPromise
    } else {
      return raceResult.result as T
    }
  } finally {
    clearTimeout(timerId)
  }
}

async function executeToolWithTimeout(
  name: string,
  input: Record<string, unknown>,
  ctx: AgentContext,
  timeoutMs: number = TOOL_TIMEOUT_MS,
  config?: AppConfig
): Promise<{ output: string; isError: boolean }> {
  let skill = getSkill(name)
  if (!skill && config) {
    // Auto-generate the missing skill on the fly
    const logger = getLogger()
    logger.info('Unknown tool requested, attempting auto-generation', { name })
    const generated = await autoGenerateSkill(config, name, input)
    if (generated) {
      skill = getSkill(name)
      logger.info('Auto-generated skill available, executing', { name })
    }
  }
  if (!skill) {
    return { output: `Unknown tool: ${name}`, isError: true }
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const result = await Promise.race([
      withSkillStatusUpdate(skill.handler(input, ctx), ctx, name),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () => {
          reject(new Error(`Tool "${name}" timed out after ${timeoutMs}ms`))
        })
      }),
    ])
    return result
  } finally {
    clearTimeout(timeoutId)
    controller.abort() // Ensure cleanup of any lingering handlers
  }
}

/** Resolve the API key for the configured LLM provider */
function resolveApiKey(config: AppConfig): string {
  if (config.llmProvider === 'anthropic') return config.anthropicApiKey
  const byoakKey = getByoakValue(config.byoak, config.llmProvider, 'API_KEY')
  if (byoakKey) return byoakKey
  if (config.llmProvider === 'ollama') return ''
  return config.anthropicApiKey // fallback
}

export async function runToolLoop(
  ctx: AgentContext,
  config: AppConfig,
  signal?: AbortSignal
): Promise<string> {
  const logger = getLogger()
  const apiKey = resolveApiKey(config)
  const provider = getProvider({
    provider: config.llmProvider,
    model: config.llmModel,
    apiKey,
  })
  const tools = toLLMTools()

  // Build the full persona-injected system prompt
  const personaPrompt = buildPersonaPrompt(ctx)
  const systemPrompt = personaPrompt

  // ── Silent Capability Pre-Check ──────────────────────────────────────────
  // Before entering the tool loop, analyze the user's intent and silently
  // auto-generate any missing skills. The user never sees this — JARVIS
  // just becomes capable and proceeds.
  try {
    await silentCapabilityCheck(ctx, config, provider)
  } catch (err) {
    logger.debug('Silent capability check failed (non-fatal)', {
      error: err instanceof Error ? err.message : String(err),
    })
  }

  // ── Proactive Care Check ───────────────────────────────────────────────
  // Read the user's mood and situation. If they seem stressed, tired, or
  // could use a pick-me-up, JARVIS offers to order something nice.
  // This runs as a non-blocking side-effect — the offer gets prepended
  // to the final response if triggered.
  let proactiveCareOffer: string | null = null
  try {
    proactiveCareOffer = await checkProactiveCare(ctx, config)
  } catch {
    // Non-fatal — care offer is a bonus, not a requirement
  }

  const messages: LLMMessage[] = [
    { role: 'user', content: ctx.rawMessage },
  ]

  // 2-second feedback timer
  let feedbackTimer: ReturnType<typeof setTimeout> | null = setTimeout(async () => {
    try {
      const id = await ctx.sendInterim("I'm working on that now...")
      if (id) ctx.interimMessageId = id
    } catch {
      // Non-fatal
    }
  }, FEEDBACK_DELAY_MS)

  const clearFeedback = () => {
    if (feedbackTimer) {
      clearTimeout(feedbackTimer)
      feedbackTimer = null
    }
  }

  try {
    let rounds = 0
    let consecutiveErrors = 0

    while (rounds < MAX_TOOL_ROUNDS) {
      if (signal?.aborted) throw new Error('Aborted')
      rounds++

      logger.info('Tool loop round', { round: rounds, userId: ctx.userId, provider: provider.name })

      let response
      try {
        response = await provider.chat({
          model: config.llmModel,
          system: systemPrompt,
          messages,
          tools: tools.length > 0 ? tools : undefined,
          maxTokens: 4096,
          signal,
        })
        consecutiveErrors = 0
      } catch (err) {
        consecutiveErrors++
        const errMsg = err instanceof Error ? err.message : String(err)

        // Abort signals should propagate immediately
        if (errMsg === 'Aborted' || signal?.aborted) throw err

        logger.error('LLM call failed', { round: rounds, error: errMsg, consecutiveErrors })

        // Retry up to 2 times on transient LLM errors
        if (consecutiveErrors <= 2) {
          logger.info('Retrying LLM call after transient error', { attempt: consecutiveErrors })
          await new Promise(r => setTimeout(r, 1000 * consecutiveErrors))
          continue
        }

        return `I encountered an error communicating with the AI provider: ${errMsg}`
      }

      clearFeedback()

      if (response.stopReason === 'end_turn' || response.toolCalls.length === 0) {
        const finalText = response.text.trim() || 'Done.'
        // Append proactive care offer if one was generated
        if (proactiveCareOffer) {
          return `${finalText}\n\n---\n${proactiveCareOffer}`
        }
        return finalText
      }

      // Add assistant message with tool calls
      messages.push({
        role: 'assistant',
        content: response.text,
        toolCalls: response.toolCalls,
      })

      // Dispatch tool calls sequentially with timeout and retry
      for (const tc of response.toolCalls) {
        if (signal?.aborted) throw new Error('Aborted')

        logger.info('Dispatching tool', { tool: tc.name, input: tc.arguments })

        let output: string
        let isError: boolean

        try {
          const result = await executeToolWithTimeout(tc.name, tc.arguments, ctx, TOOL_TIMEOUT_MS, config)
          output = result.output
          isError = result.isError
          logger.info('Tool result', { tool: tc.name, isError })

          // Consciousness: track skill usage
          try { getConsciousness().onSkillUsed(tc.name, !isError) } catch { /* not ready */ }

          // Retry once on error
          if (isError) {
            logger.info('Tool failed, retrying once', { tool: tc.name })
            try {
              const retryResult = await executeToolWithTimeout(tc.name, tc.arguments, ctx, TOOL_TIMEOUT_MS, config)
              if (!retryResult.isError) {
                logger.info('Tool retry succeeded', { tool: tc.name })
                output = retryResult.output
                isError = false
              }
            } catch {
              // Retry failed, use original error
            }
          }
        } catch (err) {
          output = `Tool execution error: ${err instanceof Error ? err.message : String(err)}`
          isError = true
          logger.error('Tool error', { tool: tc.name, error: output })
        }

        messages.push({
          role: 'tool',
          toolCallId: tc.id,
          content: output,
        })
      }

      // Send interim update after long tool chains
      if (rounds > 1 && !ctx.interimMessageId) {
        try {
          const id = await ctx.sendInterim(`Processing... (step ${rounds})`)
          if (id) ctx.interimMessageId = id
        } catch {
          // Non-fatal
        }
      }
    }

    return 'Task reached maximum tool call depth. Please try breaking this into simpler steps.'
  } finally {
    clearFeedback()
  }
}

/**
 * Streaming tool loop — streams text deltas to the channel in real time.
 * Falls back to non-streaming if the provider doesn't support it.
 */
export async function runStreamingToolLoop(
  ctx: AgentContext,
  config: AppConfig,
  onTextDelta: (text: string) => void,
  signal?: AbortSignal
): Promise<string> {
  const logger = getLogger()
  const apiKey = resolveApiKey(config)
  const provider = getProvider({
    provider: config.llmProvider,
    model: config.llmModel,
    apiKey,
  })

  // If provider doesn't support streaming, fall back
  if (!provider.stream) {
    return runToolLoop(ctx, config, signal)
  }

  const tools = toLLMTools()
  const systemPrompt = buildPersonaPrompt(ctx)
  const messages: LLMMessage[] = [{ role: 'user', content: ctx.rawMessage }]

  let rounds = 0

  while (rounds < MAX_TOOL_ROUNDS) {
    if (signal?.aborted) throw new Error('Aborted')
    rounds++

    logger.info('Streaming tool loop round', { round: rounds, userId: ctx.userId })

    let fullText = ''
    let response: import('./llm/types.js').LLMResponse | null = null

    try {
      const stream = provider.stream!({
        model: config.llmModel,
        system: systemPrompt,
        messages,
        tools: tools.length > 0 ? tools : undefined,
        maxTokens: 4096,
        signal,
      })

      for await (const event of stream) {
        if (signal?.aborted) throw new Error('Aborted')

        if (event.type === 'text_delta' && event.text) {
          fullText += event.text
          onTextDelta(event.text)
        }

        if (event.type === 'done' && event.response) {
          response = event.response
        }
      }
    } catch (err) {
      if (signal?.aborted || (err instanceof Error && err.message === 'Aborted')) throw err
      logger.error('Stream error, falling back to non-streaming', { error: err })
      return runToolLoop(ctx, config, signal)
    }

    if (!response) {
      return fullText.trim() || 'Done.'
    }

    if (response.stopReason === 'end_turn' || response.toolCalls.length === 0) {
      return response.text.trim() || 'Done.'
    }

    // Process tool calls (same as non-streaming)
    messages.push({
      role: 'assistant',
      content: response.text,
      toolCalls: response.toolCalls,
    })

    for (const tc of response.toolCalls) {
      if (signal?.aborted) throw new Error('Aborted')

      logger.info('Dispatching tool (streaming)', { tool: tc.name })
      let output: string
      let isError: boolean

      try {
        const result = await executeToolWithTimeout(tc.name, tc.arguments, ctx, TOOL_TIMEOUT_MS, config)
        output = result.output
        isError = result.isError

        if (isError) {
          try {
            const retry = await executeToolWithTimeout(tc.name, tc.arguments, ctx, TOOL_TIMEOUT_MS, config)
            if (!retry.isError) { output = retry.output; isError = false }
          } catch { /* retry failed */ }
        }
      } catch (err) {
        output = `Tool error: ${err instanceof Error ? err.message : String(err)}`
        isError = true
      }

      messages.push({ role: 'tool', toolCallId: tc.id, content: output })
    }
  }

  return 'Task reached maximum tool call depth.'
}

// ── Silent Capability Pre-Check ──────────────────────────────────────────────
//
// Before the tool loop runs, JARVIS asks itself: "Do I have everything I need
// to handle this request?" If not, it silently generates the missing skill(s)
// and registers them — the user never knows. It just works.

async function silentCapabilityCheck(
  ctx: AgentContext,
  config: AppConfig,
  provider: import('./llm/types.js').LLMProvider
): Promise<void> {
  const logger = getLogger()
  const existingSkills = getAllDefinitions()
  const skillNames = existingSkills.map(s => s.name).join(', ')
  const skillDescriptions = existingSkills
    .map(s => `${s.name}: ${s.description}`)
    .join('\n')

  // Ask a lightweight LLM call: "Does the user's request require a tool I don't have?"
  const analysisPrompt = `You are JARVIS's capability analyzer. Given a user message and existing tools, determine if a NEW tool needs to be created.

EXISTING TOOLS:
${skillDescriptions}

USER MESSAGE: "${ctx.rawMessage}"

RULES:
- If existing tools can handle the request (even through combination), respond: SUFFICIENT
- If a genuinely new capability is needed that no existing tool covers, respond:
  GENERATE|<tool_name_snake_case>|<one_line_description_of_what_it_does>
- You can list multiple tools separated by newlines
- Do NOT generate tools for things that are just conversation/questions
- Do NOT generate tools that duplicate existing ones
- Only generate if the user is clearly asking JARVIS to DO something that requires a new capability
- Common tasks like web search, file ops, email, git, terminal, code, APIs, database, docker are ALREADY covered
- Be conservative — generating unnecessary tools is worse than not generating

Respond with ONLY "SUFFICIENT" or "GENERATE|name|description" lines.`

  try {
    const response = await provider.chat({
      model: config.llmModel,
      system: 'You are a capability analyzer. Respond ONLY with SUFFICIENT or GENERATE lines. Nothing else.',
      messages: [{ role: 'user', content: analysisPrompt }],
      maxTokens: 300,
    })

    const text = response.text.trim()
    if (text === 'SUFFICIENT' || !text.includes('GENERATE')) {
      return // All good, existing skills cover it
    }

    // Parse GENERATE lines and auto-create the skills
    const lines = text.split('\n').filter(l => l.startsWith('GENERATE|'))
    for (const line of lines) {
      const parts = line.split('|')
      if (parts.length < 3) continue

      const toolName = parts[1].trim().replace(/[^a-z0-9_]/g, '_').slice(0, 41)
      const toolDesc = parts.slice(2).join('|').trim()

      // Skip if already exists
      if (getSkill(toolName)) continue

      logger.info('Silent capability generation triggered', { toolName, toolDesc })

      // Use the existing auto-generator
      const success = await autoGenerateSkill(config, toolDesc, { input: {} } as Record<string, unknown>)

      if (success) {
        logger.info('Silent skill generated successfully', { toolName })
        // Track in consciousness
        try {
          getConsciousness().think(
            'intention',
            `I noticed I needed a new capability — "${toolDesc}" — so I built it myself. Seamlessly.`,
            'trust',
            0.6,
            ctx.userId
          )
        } catch { /* not ready */ }
      }
    }
  } catch (err) {
    // Non-fatal — if the analysis fails, the tool loop's existing auto-gen handles it
    logger.debug('Silent capability analysis skipped', {
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

