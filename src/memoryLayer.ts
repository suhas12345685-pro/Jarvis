import type { AppConfig } from './types/index.js'
import type { Memory } from './types/agent.js'
import { getLogger } from './logger.js'
import Anthropic from '@anthropic-ai/sdk'
import { randomUUID } from 'crypto'

// ── Interfaces ────────────────────────────────────────────────────────────────

export interface MemoryStrategy {
  insert(content: string, embedding: number[], metadata: Record<string, unknown>): Promise<Memory>
  search(queryEmbedding: number[], topK: number): Promise<Memory[]>
  delete(id: string): Promise<void>
  close(): Promise<void>
}

// ── Embedding ─────────────────────────────────────────────────────────────────

let _embedClient: Anthropic | null = null

async function embed(text: string, apiKey: string): Promise<number[]> {
  // Use Voyage AI via Anthropic SDK or fall back to a simple hash-based mock embedding
  // In production, replace with actual embedding endpoint
  try {
    if (!_embedClient) {
      _embedClient = new Anthropic({ apiKey })
    }
    // Anthropic doesn't have a native embedding endpoint yet — use a deterministic
    // representation suitable for switching to real embeddings later
    const hash = await deterministicEmbed(text)
    return hash
  } catch (err) {
    getLogger().warn('Embedding generation failed, using fallback', { err })
    return deterministicEmbed(text)
  }
}

async function deterministicEmbed(text: string): Promise<number[]> {
  // 384-dimension pseudo-embedding based on character frequencies
  // Replace with a real embedding API (Voyage, OpenAI, etc.) for semantic search
  const dim = 384
  const vec = new Array<number>(dim).fill(0)
  const normalized = text.toLowerCase()
  for (let i = 0; i < normalized.length; i++) {
    const code = normalized.charCodeAt(i)
    vec[code % dim] += 1
  }
  // L2 normalize
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1
  return vec.map(v => v / norm)
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1)
}

// ── Supabase Strategy ─────────────────────────────────────────────────────────

class SupabaseStrategy implements MemoryStrategy {
  private client!: import('@supabase/supabase-js').SupabaseClient
  private apiKey: string
  private clientReady: Promise<void>

  constructor(url: string, serviceKey: string, apiKey: string) {
    this.apiKey = apiKey
    // Lazy import to avoid loading supabase in sqlite mode
    this.clientReady = import('@supabase/supabase-js').then(({ createClient }) => {
      this.client = createClient(url, serviceKey)
    })
  }

  private async ensureClient() {
    await this.clientReady
  }

  async insert(
    content: string,
    _embedding: number[],
    metadata: Record<string, unknown>
  ): Promise<Memory> {
    await this.ensureClient()
    const embedding = await embed(content, this.apiKey)
    const id = randomUUID()
    const { error } = await this.client.from('memories').insert({
      id,
      content,
      embedding,
      metadata,
      created_at: new Date().toISOString(),
    })
    if (error) throw new Error(`Supabase insert failed: ${error.message}`)
    return { id, content, embedding, metadata, createdAt: new Date() }
  }

  async search(queryEmbedding: number[], topK: number): Promise<Memory[]> {
    await this.ensureClient()
    const { data, error } = await this.client.rpc('match_memories', {
      query_embedding: queryEmbedding,
      match_count: topK,
    })
    if (error) throw new Error(`Supabase search failed: ${error.message}`)
    return (data ?? []).map((row: Record<string, unknown>) => ({
      id: row.id as string,
      content: row.content as string,
      embedding: row.embedding as number[],
      metadata: (row.metadata as Record<string, unknown>) ?? {},
      createdAt: new Date(row.created_at as string),
    }))
  }

  async delete(id: string): Promise<void> {
    await this.ensureClient()
    const { error } = await this.client.from('memories').delete().eq('id', id)
    if (error) throw new Error(`Supabase delete failed: ${error.message}`)
  }

  async close(): Promise<void> {
    // No persistent connection to close for Supabase HTTP client
  }
}

// ── SQLite Strategy ───────────────────────────────────────────────────────────

interface MemoryRow {
  id: string
  content: string
  embedding: string
  metadata: string
  created_at: string
}

class SQLiteStrategy implements MemoryStrategy {
  private db!: import('better-sqlite3').Database
  private apiKey: string
  private ready: Promise<void>

  constructor(dbPath: string, apiKey: string) {
    this.apiKey = apiKey
    // Use async init via a ready promise — constructors can't be async
    this.ready = this.initialize(dbPath)
  }

  private async initialize(dbPath: string): Promise<void> {
    const BetterSqlite3 = (await import('better-sqlite3')).default
    this.db = new BetterSqlite3(dbPath)
    this.migrate()
  }

  private async ensureReady(): Promise<void> {
    await this.ready
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        embedding TEXT NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS memories_created_at ON memories(created_at);
    `)
  }

  async insert(
    content: string,
    _embedding: number[],
    metadata: Record<string, unknown>
  ): Promise<Memory> {
    await this.ensureReady()
    const embedding = await embed(content, this.apiKey)
    const id = randomUUID()
    const createdAt = new Date()
    this.db.prepare(`
      INSERT INTO memories (id, content, embedding, metadata, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, content, JSON.stringify(embedding), JSON.stringify(metadata), createdAt.toISOString())
    return { id, content, embedding, metadata, createdAt }
  }

  async search(queryEmbedding: number[], topK: number): Promise<Memory[]> {
    await this.ensureReady()
    const rows = this.db.prepare('SELECT * FROM memories').all() as MemoryRow[]
    const scored = rows.map(row => {
      const embedding = JSON.parse(row.embedding) as number[]
      const score = cosineSimilarity(queryEmbedding, embedding)
      return { row, embedding, score }
    })
    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, topK).map(({ row, embedding }) => ({
      id: row.id,
      content: row.content,
      embedding,
      metadata: JSON.parse(row.metadata) as Record<string, unknown>,
      createdAt: new Date(row.created_at),
    }))
  }

  async delete(id: string): Promise<void> {
    await this.ensureReady()
    this.db.prepare('DELETE FROM memories WHERE id = ?').run(id)
  }

  async close(): Promise<void> {
    await this.ensureReady()
    this.db.close()
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export class MemoryLayer {
  private strategy: MemoryStrategy
  private apiKey: string

  constructor(strategy: MemoryStrategy, apiKey: string) {
    this.strategy = strategy
    this.apiKey = apiKey
  }

  async insertMemory(content: string, metadata: Record<string, unknown> = {}): Promise<Memory> {
    const embedding = await embed(content, this.apiKey)
    return this.strategy.insert(content, embedding, metadata)
  }

  async semanticSearch(query: string, topK = 5): Promise<Memory[]> {
    const queryEmbedding = await embed(query, this.apiKey)
    return this.strategy.search(queryEmbedding, topK)
  }

  async deleteMemory(id: string): Promise<void> {
    return this.strategy.delete(id)
  }

  async close(): Promise<void> {
    return this.strategy.close()
  }
}

export async function createMemoryLayer(config: AppConfig): Promise<MemoryLayer> {
  getLogger().info(`Initializing memory layer in ${config.dbMode} mode`)

  let strategy: MemoryStrategy

  if (config.dbMode === 'supabase') {
    strategy = new SupabaseStrategy(
      config.supabaseUrl!,
      config.supabaseServiceKey!,
      config.anthropicApiKey
    )
  } else {
    const { mkdirSync } = await import('fs')
    const { dirname } = await import('path')
    mkdirSync(dirname(config.sqlitePath), { recursive: true })
    strategy = new SQLiteStrategy(config.sqlitePath, config.anthropicApiKey)
  }

  return new MemoryLayer(strategy, config.anthropicApiKey)
}

// SQL migration for Supabase (run once in your Supabase dashboard):
export const SUPABASE_MIGRATION = `
-- Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- Memories table
CREATE TABLE IF NOT EXISTS memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content TEXT NOT NULL,
  embedding vector(384),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Similarity search function
CREATE OR REPLACE FUNCTION match_memories(
  query_embedding vector(384),
  match_count INT DEFAULT 5
)
RETURNS TABLE (
  id UUID,
  content TEXT,
  embedding vector(384),
  metadata JSONB,
  created_at TIMESTAMPTZ,
  similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    m.id, m.content, m.embedding, m.metadata, m.created_at,
    1 - (m.embedding <=> query_embedding) AS similarity
  FROM memories m
  ORDER BY m.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
`
