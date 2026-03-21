/**
 * Memory Classifier — Cognitive categorisation of memories.
 *
 * After each ReAct execution JARVIS classifies the memories it produced
 * (observations, tool results, learnings) into cognitive types so they
 * can be stored and retrieved with appropriate weighting.
 *
 * Memory types:
 *   episodic   — events, interactions, things that happened
 *   semantic   — facts, definitions, knowledge
 *   procedural — how-to, recipes, multi-step processes
 *   emotional  — feelings, moods, social signals
 */

import type { LLMProvider } from '../llm/types.js'
import { getLogger } from '../logger.js'

// ── Types ───────────────────────────────────────────────────────────────────

export type MemoryType = 'episodic' | 'semantic' | 'procedural' | 'emotional'

export interface ClassifiedMemory {
  content: string
  type: MemoryType
  confidence: number   // 0-1
  tags: string[]       // free-form tags for retrieval
  importance: number   // 0-1, how important to retain long-term
}

// ── Fast heuristic classifier (no LLM call) ─────────────────────────────────

const PROCEDURAL_SIGNALS = /\b(step\s*\d|first|then|next|finally|how\s+to|install|run|execute|create|build|deploy|configure|setup)\b/i
const EMOTIONAL_SIGNALS  = /\b(feel|happy|sad|angry|frustrated|excited|stressed|tired|anxious|grateful|love|hate|worried|mood)\b/i
const EPISODIC_SIGNALS   = /\b(happened|yesterday|today|just now|earlier|meeting|conversation|called|visited|went|saw|met)\b/i

export function classifyFast(content: string): { type: MemoryType; confidence: number } {
  const lower = content.toLowerCase()

  // Score each type
  const scores: Record<MemoryType, number> = {
    episodic: 0,
    semantic: 0,
    procedural: 0,
    emotional: 0,
  }

  if (PROCEDURAL_SIGNALS.test(lower)) scores.procedural += 2
  if (EMOTIONAL_SIGNALS.test(lower))  scores.emotional += 2
  if (EPISODIC_SIGNALS.test(lower))   scores.episodic += 2

  // Semantic is the fallback — facts and knowledge
  if (lower.includes('is ') || lower.includes('are ') || lower.includes('means ') || lower.includes('defined as')) {
    scores.semantic += 1
  }

  // Find winner
  let best: MemoryType = 'semantic'
  let bestScore = 0
  for (const [type, score] of Object.entries(scores) as [MemoryType, number][]) {
    if (score > bestScore) {
      best = type
      bestScore = score
    }
  }

  // Confidence: if no signals matched, low confidence semantic
  const confidence = bestScore === 0 ? 0.4 : Math.min(1, 0.5 + bestScore * 0.15)
  return { type: best, confidence }
}

// ── LLM-powered classifier (higher quality, async) ──────────────────────────

const CLASSIFY_SYSTEM = `You are a memory classifier for an AI agent named JARVIS.
Given a piece of text, classify it into exactly ONE memory type and extract tags.

Memory types:
- episodic: Events, interactions, things that happened (who, what, when)
- semantic: Facts, definitions, knowledge, preferences
- procedural: How-to instructions, multi-step processes, recipes
- emotional: Feelings, moods, social signals, empathy observations

Respond in this EXACT format (no extra text):
TYPE: <episodic|semantic|procedural|emotional>
IMPORTANCE: <0.0-1.0>
TAGS: <comma-separated tags>
`

export async function classifyWithLLM(
  content: string,
  provider: LLMProvider,
  model: string,
): Promise<ClassifiedMemory> {
  const logger = getLogger()

  try {
    const response = await provider.chat({
      model,
      system: CLASSIFY_SYSTEM,
      messages: [{ role: 'user', content: `Classify this memory:\n"${content.slice(0, 500)}"` }],
      maxTokens: 100,
    })

    const text = response.text.trim()
    const typeMatch = text.match(/TYPE:\s*(episodic|semantic|procedural|emotional)/i)
    const importanceMatch = text.match(/IMPORTANCE:\s*([\d.]+)/i)
    const tagsMatch = text.match(/TAGS:\s*(.+)/i)

    const type = (typeMatch?.[1]?.toLowerCase() as MemoryType) ?? 'semantic'
    const importance = Math.max(0, Math.min(1, parseFloat(importanceMatch?.[1] ?? '0.5')))
    const tags = tagsMatch?.[1]?.split(',').map(t => t.trim()).filter(Boolean) ?? []

    return { content, type, confidence: 0.9, tags, importance }
  } catch (err) {
    logger.debug('LLM memory classification failed, using heuristic', {
      error: err instanceof Error ? err.message : String(err),
    })
    return classifyHeuristic(content)
  }
}

// ── Heuristic wrapper that returns full ClassifiedMemory ─────────────────────

export function classifyHeuristic(content: string): ClassifiedMemory {
  const { type, confidence } = classifyFast(content)

  // Extract simple tags: nouns and key phrases
  const words = content.toLowerCase().split(/\s+/).filter(w => w.length > 4)
  const tags = [...new Set(words)].slice(0, 5)

  return {
    content,
    type,
    confidence,
    tags,
    importance: type === 'procedural' ? 0.7 : type === 'emotional' ? 0.6 : 0.5,
  }
}

// ── Batch classifier ────────────────────────────────────────────────────────

/**
 * Classify multiple memories. Uses LLM if provider is available,
 * otherwise falls back to heuristic.
 */
export async function classifyBatch(
  contents: string[],
  provider?: LLMProvider,
  model?: string,
): Promise<ClassifiedMemory[]> {
  if (provider && model) {
    // Classify in parallel with LLM (capped at 5 concurrent)
    const results: ClassifiedMemory[] = []
    const chunks = chunkArray(contents, 5)
    for (const chunk of chunks) {
      const batch = await Promise.all(
        chunk.map(c => classifyWithLLM(c, provider, model))
      )
      results.push(...batch)
    }
    return results
  }

  // Heuristic fallback
  return contents.map(classifyHeuristic)
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size))
  }
  return chunks
}
