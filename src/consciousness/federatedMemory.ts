/**
 * Federated Memory Manager
 *
 * Wraps the existing MemoryLayer with cognitive classification so that
 * memories are stored with type metadata and can be recalled with
 * type-weighted relevance scoring.
 *
 * "Federated" because it unifies multiple memory strategies (local SQLite,
 * Supabase cloud) behind a single API that adds cognitive intelligence.
 *
 * Usage:
 *   const fm = new FederatedMemoryManager(memoryLayer, provider, model)
 *   await fm.store("User prefers dark mode", "user123")
 *   const results = await fm.search("color preferences", { types: ['semantic'] })
 */

import type { MemoryLayer } from '../memoryLayer.js'
import type { LLMProvider } from '../llm/types.js'
import type { Memory } from '../types/agent.js'
import { getLogger } from '../logger.js'
import {
  classifyHeuristic,
  classifyWithLLM,
  type ClassifiedMemory,
  type MemoryType,
} from './memoryClassifier.js'

const logger = getLogger()

// ── Types ───────────────────────────────────────────────────────────────────

export interface FederatedSearchOptions {
  types?: MemoryType[]      // filter to specific memory types
  topK?: number             // max results (default 10)
  minImportance?: number    // filter by importance threshold (0-1)
  userId?: string           // filter to a specific user
  boostTypes?: Partial<Record<MemoryType, number>>  // weight multipliers
}

export interface FederatedMemoryResult {
  content: string
  type: MemoryType
  importance: number
  tags: string[]
  score: number             // combined relevance score
  metadata: Record<string, unknown>
}

// ── Manager ─────────────────────────────────────────────────────────────────

export class FederatedMemoryManager {
  private memory: MemoryLayer
  private provider: LLMProvider | null
  private model: string

  constructor(memory: MemoryLayer, provider?: LLMProvider, model?: string) {
    this.memory = memory
    this.provider = provider ?? null
    this.model = model ?? ''
  }

  /**
   * Store a memory with automatic cognitive classification.
   */
  async store(
    content: string,
    userId?: string,
    extraMetadata?: Record<string, unknown>,
  ): Promise<ClassifiedMemory> {
    // Classify the memory
    let classified: ClassifiedMemory
    if (this.provider && this.model) {
      classified = await classifyWithLLM(content, this.provider, this.model)
    } else {
      classified = classifyHeuristic(content)
    }

    // Store in the underlying memory layer with classification metadata
    await this.memory.insertMemory(content, {
      ...extraMetadata,
      memoryType: classified.type,
      confidence: classified.confidence,
      importance: classified.importance,
      tags: classified.tags,
      userId,
      classifiedAt: new Date().toISOString(),
    })

    logger.debug('Federated memory stored', {
      type: classified.type,
      importance: classified.importance,
      tags: classified.tags,
    })

    return classified
  }

  /**
   * Store a pre-classified memory (skip classification step).
   */
  async storeDirect(
    classified: ClassifiedMemory,
    userId?: string,
    extraMetadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.memory.insertMemory(classified.content, {
      ...extraMetadata,
      memoryType: classified.type,
      confidence: classified.confidence,
      importance: classified.importance,
      tags: classified.tags,
      userId,
      classifiedAt: new Date().toISOString(),
    })
  }

  /**
   * Search memories with type filtering and importance weighting.
   */
  async search(
    query: string,
    options: FederatedSearchOptions = {},
  ): Promise<FederatedMemoryResult[]> {
    const {
      types,
      topK = 10,
      minImportance = 0,
      userId,
      boostTypes,
    } = options

    // Fetch more than needed so we can filter/re-rank
    const fetchK = Math.min(topK * 3, 50)
    const raw = await this.memory.semanticSearch(query, fetchK)

    let results: FederatedMemoryResult[] = raw.map((m: Memory, index: number) => {
      const memType = (m.metadata.memoryType as MemoryType) ?? 'semantic'
      const importance = (m.metadata.importance as number) ?? 0.5
      const tags = (m.metadata.tags as string[]) ?? []

      // Base score: inverse of rank (higher is better)
      let score = 1 - (index / fetchK)

      // Boost by type if requested
      if (boostTypes && boostTypes[memType]) {
        score *= boostTypes[memType]!
      }

      // Boost by importance
      score *= (0.5 + importance * 0.5)

      return {
        content: m.content,
        type: memType,
        importance,
        tags,
        score,
        metadata: m.metadata,
      }
    })

    // Filter by type
    if (types && types.length > 0) {
      const typeSet = new Set(types)
      results = results.filter(r => typeSet.has(r.type))
    }

    // Filter by importance
    if (minImportance > 0) {
      results = results.filter(r => r.importance >= minImportance)
    }

    // Filter by userId
    if (userId) {
      results = results.filter(r => r.metadata.userId === userId)
    }

    // Sort by score descending and limit
    results.sort((a, b) => b.score - a.score)
    return results.slice(0, topK)
  }

  /**
   * Search specifically for procedural memories (how-to knowledge).
   * Useful for the ReAct loop when it needs to recall how to do something.
   */
  async recallProcedure(query: string, topK = 3): Promise<string[]> {
    const results = await this.search(query, {
      types: ['procedural'],
      topK,
      boostTypes: { procedural: 1.5 },
    })
    return results.map(r => r.content)
  }

  /**
   * Search for episodic memories (past events/interactions).
   */
  async recallEpisodes(query: string, userId?: string, topK = 5): Promise<string[]> {
    const results = await this.search(query, {
      types: ['episodic'],
      topK,
      userId,
      boostTypes: { episodic: 1.5 },
    })
    return results.map(r => r.content)
  }

  /**
   * Search for semantic memories (facts/knowledge).
   */
  async recallFacts(query: string, topK = 5): Promise<string[]> {
    const results = await this.search(query, {
      types: ['semantic'],
      topK,
      boostTypes: { semantic: 1.5 },
    })
    return results.map(r => r.content)
  }

  /**
   * Broad search across all memory types with default weighting.
   * Returns a formatted context string ready for LLM injection.
   */
  async recallContext(query: string, topK = 8): Promise<string> {
    const results = await this.search(query, { topK })

    if (results.length === 0) return ''

    const lines = results.map(r =>
      `[${r.type}] ${r.content}`
    )

    return lines.join('\n')
  }
}
