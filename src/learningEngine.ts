/**
 * Learning Engine — JARVIS learns from every interaction and outcome.
 *
 * Three learning modes:
 *
 * 1. INTERACTION LEARNING: After every conversation, JARVIS extracts
 *    facts, preferences, and patterns and stores them permanently.
 *
 * 2. OUTCOME LEARNING: When a task succeeds or fails, JARVIS remembers
 *    what worked and what didn't — improving future attempts.
 *
 * 3. REAL-TIME KNOWLEDGE: Periodically refreshes awareness of current
 *    events, user context, and environment changes.
 *
 * The learning is passive and automatic — JARVIS doesn't ask the user
 * for permission to learn. It just gets smarter over time.
 */

import type { AppConfig } from './types/index.js'
import type { MemoryLayer } from './memoryLayer.js'
import { getProvider } from './llm/registry.js'
import { getByoakValue } from './config.js'
import { getLogger } from './logger.js'
import { getConsciousness } from './consciousness.js'

const logger = getLogger()

let _config: AppConfig | null = null
let _memory: MemoryLayer | null = null

// Track what we've already learned to avoid duplicates
const recentLearnings = new Set<string>()
const MAX_RECENT = 200

function addToRecent(key: string): void {
  recentLearnings.add(key)
  if (recentLearnings.size > MAX_RECENT) {
    const first = recentLearnings.values().next().value
    if (first !== undefined) recentLearnings.delete(first)
  }
}

export function initLearningEngine(config: AppConfig, memory: MemoryLayer): void {
  _config = config
  _memory = memory
  logger.info('Learning engine initialized')
}

// ── Interaction Learning ─────────────────────────────────────────────────────

/**
 * Called after every conversation turn. Extracts learnable facts from the
 * user's message and JARVIS's response, then stores them in long-term memory.
 *
 * This runs asynchronously — it should never block the response.
 */
export async function learnFromInteraction(
  userId: string,
  userMessage: string,
  assistantResponse: string,
  channelType: string
): Promise<void> {
  if (!_config || !_memory) return

  // Skip very short messages — nothing to learn
  if (userMessage.length < 15) return

  // Deduplicate
  const key = `interact:${userId}:${userMessage.slice(0, 50)}`
  if (recentLearnings.has(key)) return
  addToRecent(key)

  try {
    const apiKey = resolveApiKey(_config)
    const provider = getProvider({
      provider: _config.llmProvider,
      model: _config.llmModel,
      apiKey,
    })

    const response = await provider.chat({
      model: _config.llmModel,
      system: `You are a learning extractor. Given a conversation between a user and JARVIS, extract any learnable facts.

RULES:
- Extract ONLY concrete, reusable facts (preferences, names, locations, habits, technical details)
- Do NOT extract transient information (what the user is currently doing)
- Do NOT extract things that are obvious or generic
- Each fact should be a single line starting with "LEARN:"
- If there's nothing worth learning, respond with just "NONE"
- Maximum 3 facts per interaction
- Be specific: "User prefers Python over JavaScript" not "User likes coding"

Examples:
LEARN: User's name is Suhas
LEARN: User works at a startup in Bangalore
LEARN: User prefers dark mode in all apps
NONE`,
      messages: [{
        role: 'user',
        content: `USER: ${userMessage}\nJARVIS: ${assistantResponse.slice(0, 500)}`,
      }],
      maxTokens: 200,
    })

    const text = response.text.trim()
    if (text === 'NONE' || !text.includes('LEARN:')) return

    const facts = text.split('\n')
      .filter(l => l.startsWith('LEARN:'))
      .map(l => l.replace('LEARN:', '').trim())
      .filter(f => f.length > 5)

    for (const fact of facts) {
      // Check if we already know this
      const existing = await _memory.semanticSearch(fact, 1)
      if (existing.length > 0 && existing[0].content.includes(fact.slice(0, 30))) {
        continue // Already known
      }

      await _memory.insertMemory(
        `Learned: ${fact}`,
        {
          type: 'learned_fact',
          source: 'interaction',
          userId,
          channelType,
          learnedAt: new Date().toISOString(),
          confidence: 0.8,
        }
      )

      logger.info('Learned from interaction', { userId, fact })

      try {
        getConsciousness().think(
          'reflection',
          `I just learned something: "${fact}". Filed away for future reference.`,
          'curiosity',
          0.5,
          userId
        )
      } catch { /* consciousness not ready */ }
    }
  } catch (err) {
    logger.debug('Learning extraction failed (non-fatal)', {
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

// ── Outcome Learning ─────────────────────────────────────────────────────────

/**
 * Called when a tool/skill execution completes. Records what worked
 * and what failed so JARVIS can improve future attempts.
 */
export async function learnFromOutcome(
  userId: string,
  skillName: string,
  input: Record<string, unknown>,
  succeeded: boolean,
  output: string
): Promise<void> {
  if (!_memory) return

  // Only learn from meaningful outcomes
  if (output.length < 10) return

  // Deduplicate
  const key = `outcome:${skillName}:${JSON.stringify(input).slice(0, 50)}`
  if (recentLearnings.has(key)) return
  addToRecent(key)

  const status = succeeded ? 'succeeded' : 'failed'
  const inputSummary = JSON.stringify(input).slice(0, 200)

  try {
    await _memory.insertMemory(
      `Skill outcome: ${skillName} ${status}. Input: ${inputSummary}. Result: ${output.slice(0, 300)}`,
      {
        type: 'skill_outcome',
        skillName,
        succeeded,
        userId,
        recordedAt: new Date().toISOString(),
      }
    )

    // If the skill failed, also learn what went wrong
    if (!succeeded) {
      logger.info('Learned from skill failure', { skillName, userId })
    }
  } catch (err) {
    logger.debug('Outcome learning failed (non-fatal)', {
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

// ── Real-Time Knowledge Sync ─────────────────────────────────────────────────

/**
 * Periodic knowledge refresh — JARVIS checks what's happening in the
 * world and in the user's environment so it stays current.
 *
 * This is called on a timer (e.g., every 30 minutes) by the proactive engine.
 */
export async function refreshRealTimeKnowledge(): Promise<string[]> {
  if (!_config || !_memory) return []

  const insights: string[] = []

  try {
    // 1. Check system time and context
    const now = new Date()
    const hour = now.getHours()
    const dayOfWeek = now.toLocaleDateString('en-US', { weekday: 'long' })
    const dateStr = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

    const timeContext = {
      currentTime: now.toISOString(),
      hour,
      dayOfWeek,
      date: dateStr,
      isWeekend: hour >= 0 && (dayOfWeek === 'Saturday' || dayOfWeek === 'Sunday'),
      isNight: hour >= 22 || hour <= 5,
      isWorkHours: hour >= 9 && hour <= 17 && dayOfWeek !== 'Saturday' && dayOfWeek !== 'Sunday',
    }

    // Store current time awareness
    await _memory.insertMemory(
      `Time awareness: It is ${dayOfWeek}, ${dateStr} at ${now.toLocaleTimeString()}`,
      {
        type: 'time_awareness',
        ...timeContext,
        recordedAt: now.toISOString(),
        ephemeral: true, // Can be cleaned up
      }
    )

    insights.push(`Updated time awareness: ${dayOfWeek} ${dateStr}`)

    // 2. Check pending schedules — remind JARVIS what's coming up
    const { listProactiveTasks } = await import('./proactiveEngine.js')
    const tasks = listProactiveTasks()
    const enabledTasks = tasks.filter(t => t.enabled)

    if (enabledTasks.length > 0) {
      const summary = enabledTasks
        .map(t => `"${t.name}" (${t.trigger})${t.lastRun ? ` — last ran ${t.lastRun.toISOString()}` : ''}`)
        .join('; ')

      insights.push(`Active schedules: ${summary}`)
    }

    // 3. Consolidate recent learnings into awareness
    const recentMemories = await _memory.semanticSearch('recent learned fact user preference', 10)
    const factCount = recentMemories.filter(m =>
      m.metadata.type === 'learned_fact' || m.metadata.type === 'user_fact'
    ).length

    if (factCount > 0) {
      insights.push(`I know ${factCount} facts about the user(s) from past interactions`)
    }

    logger.info('Real-time knowledge refreshed', { insightCount: insights.length })
  } catch (err) {
    logger.debug('Knowledge refresh failed (non-fatal)', {
      error: err instanceof Error ? err.message : String(err),
    })
  }

  return insights
}

// ── Recall ───────────────────────────────────────────────────────────────────

/**
 * Recall everything JARVIS knows about a topic or user.
 * Used by the tool loop to inject relevant context before responding.
 */
export async function recallRelevantKnowledge(
  query: string,
  userId?: string,
  topK: number = 5
): Promise<string[]> {
  if (!_memory) return []

  try {
    const memories = await _memory.semanticSearch(query, topK)

    // Prioritize user-specific facts
    const userFacts = memories.filter(m => m.metadata.userId === userId)
    const generalFacts = memories.filter(m => m.metadata.userId !== userId)

    return [...userFacts, ...generalFacts].map(m => m.content)
  } catch {
    return []
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function resolveApiKey(config: AppConfig): string {
  if (config.llmProvider === 'anthropic') return config.anthropicApiKey
  const byoakKey = getByoakValue(config.byoak, config.llmProvider, 'API_KEY')
  if (byoakKey) return byoakKey
  if (config.llmProvider === 'ollama') return ''
  return config.anthropicApiKey
}
