import type { AppConfig } from './types/index.js'
import type { Memory } from './types/agent.js'
import { getLogger } from './logger.js'
import { randomUUID } from 'crypto'

// ── Interfaces ────────────────────────────────────────────────────────────────

export interface MemoryStrategy {
  insert(content: string, embedding: number[], metadata: Record<string, unknown>): Promise<Memory>
  search(queryEmbedding: number[], topK: number): Promise<Memory[]>
  delete(id: string): Promise<void>
  close(): Promise<void>
}

// ── Embedding ─────────────────────────────────────────────────────────────────

export type EmbeddingProvider = 'openai' | 'voyage' | 'gemini' | 'anthropic' | 'ollama' | 'cohere' | 'deepseek' | 'local'

interface EmbeddingConfig {
  provider: EmbeddingProvider
  apiKey: string
  model: string
  baseUrl?: string
  dimensions: number
}

const EMBEDDING_DEFAULTS: Record<string, { model: string; baseUrl: string; dimensions: number }> = {
  openai:    { model: 'text-embedding-3-small', baseUrl: 'https://api.openai.com/v1', dimensions: 1536 },
  voyage:    { model: 'voyage-3-lite', baseUrl: 'https://api.voyageai.com/v1', dimensions: 1024 },
  gemini:    { model: 'text-embedding-004', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', dimensions: 768 },
  anthropic: { model: 'voyage-3-lite', baseUrl: 'https://api.voyageai.com/v1', dimensions: 1024 },
  ollama:    { model: 'nomic-embed-text', baseUrl: 'http://localhost:11434', dimensions: 768 },
  cohere:    { model: 'embed-english-v3.0', baseUrl: 'https://api.cohere.ai/v1', dimensions: 1024 },
  deepseek:  { model: 'text-embedding-3-small', baseUrl: 'https://api.deepseek.com/v1', dimensions: 1536 },
}

function resolveEmbeddingConfig(config: AppConfig): EmbeddingConfig {
  const embProvider = process.env.EMBEDDING_PROVIDER as EmbeddingProvider | undefined
  const embModel = process.env.EMBEDDING_MODEL
  const embBaseUrl = process.env.EMBEDDING_BASE_URL

  // Explicit embedding provider set
  if (embProvider && embProvider !== 'local') {
    const defaults = EMBEDDING_DEFAULTS[embProvider]
    const apiKey = resolveEmbeddingApiKey(embProvider, config)
    return {
      provider: embProvider,
      apiKey,
      model: embModel ?? defaults?.model ?? 'text-embedding-3-small',
      baseUrl: embBaseUrl ?? defaults?.baseUrl,
      dimensions: defaults?.dimensions ?? 1536,
    }
  }

  if (embProvider === 'local') {
    return { provider: 'local', apiKey: '', model: 'local', dimensions: 384 }
  }

  // Auto-detect from LLM provider
  const llmProvider = config.llmProvider
  const detectedProvider = autoDetectEmbeddingProvider(llmProvider, config)
  if (detectedProvider) {
    const defaults = EMBEDDING_DEFAULTS[detectedProvider]
    return {
      provider: detectedProvider,
      apiKey: resolveEmbeddingApiKey(detectedProvider, config),
      model: defaults?.model ?? 'text-embedding-3-small',
      baseUrl: defaults?.baseUrl,
      dimensions: defaults?.dimensions ?? 1536,
    }
  }

  return { provider: 'local', apiKey: '', model: 'local', dimensions: 384 }
}

function autoDetectEmbeddingProvider(llmProvider: string, config: AppConfig): EmbeddingProvider | null {
  // Map LLM providers to their embedding providers
  const providerMap: Record<string, EmbeddingProvider> = {
    openai: 'openai',
    gemini: 'gemini',
    anthropic: 'voyage',  // Anthropic recommends Voyage
    voyage: 'voyage',
    ollama: 'ollama',
    cohere: 'cohere',
    deepseek: 'deepseek',
    xai: 'openai',       // xAI doesn't have embeddings; fall through
    moonshot: 'openai',
    meta: 'openai',
    perplexity: 'openai',
  }

  const candidate = providerMap[llmProvider]
  if (!candidate) return null

  // Verify we have the API key
  const key = resolveEmbeddingApiKey(candidate, config)
  if (key || candidate === 'ollama') return candidate

  // Fallback: check if any embedding-capable provider has a key
  for (const provider of ['openai', 'gemini', 'voyage', 'cohere'] as EmbeddingProvider[]) {
    const k = resolveEmbeddingApiKey(provider, config)
    if (k) return provider
  }

  return null
}

function resolveEmbeddingApiKey(provider: EmbeddingProvider, config: AppConfig): string {
  // Check BYOAK entries
  const byoakKey = config.byoak.find(
    e => e.service === provider && e.keyName === 'API_KEY'
  )?.value

  if (byoakKey) return byoakKey

  // Provider-specific env vars
  switch (provider) {
    case 'openai':
      return process.env.BYOAK_OPENAI_API_KEY ?? ''
    case 'voyage':
    case 'anthropic':
      return process.env.VOYAGE_API_KEY ?? process.env.BYOAK_VOYAGE_API_KEY ?? config.anthropicApiKey ?? ''
    case 'gemini':
      return process.env.BYOAK_GEMINI_API_KEY ?? ''
    case 'cohere':
      return process.env.BYOAK_COHERE_API_KEY ?? ''
    case 'deepseek':
      return process.env.BYOAK_DEEPSEEK_API_KEY ?? ''
    case 'ollama':
      return ''
    default:
      return ''
  }
}

// Cache for embedding config
let _embConfig: EmbeddingConfig | null = null

async function embedViaAPI(text: string, cfg: EmbeddingConfig): Promise<number[]> {
  const { default: axios } = await import('axios')

  // Ollama has a unique API format
  if (cfg.provider === 'ollama') {
    const response = await axios.post(`${cfg.baseUrl}/api/embeddings`, {
      model: cfg.model,
      prompt: text,
    }, { timeout: 15_000 })
    return response.data.embedding as number[]
  }

  // Gemini has a unique API format
  if (cfg.provider === 'gemini') {
    const response = await axios.post(
      `${cfg.baseUrl}/models/${cfg.model}:embedContent?key=${cfg.apiKey}`,
      {
        model: `models/${cfg.model}`,
        content: { parts: [{ text }] },
      },
      { headers: { 'Content-Type': 'application/json' }, timeout: 15_000 }
    )
    const data = response.data as { embedding: { values: number[] } }
    return data.embedding.values
  }

  // Cohere has a unique API format
  if (cfg.provider === 'cohere') {
    const response = await axios.post(
      `${cfg.baseUrl}/embed`,
      {
        texts: [text],
        model: cfg.model,
        input_type: 'search_document',
        truncate: 'END',
      },
      {
        headers: {
          'Authorization': `Bearer ${cfg.apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 15_000,
      }
    )
    const data = response.data as { embeddings: number[][] }
    return data.embeddings[0]
  }

  // OpenAI-compatible API (works for OpenAI, Voyage, DeepSeek, and others)
  const response = await axios.post(
    `${cfg.baseUrl}/embeddings`,
    {
      model: cfg.model,
      input: text,
    },
    {
      headers: {
        'Authorization': `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 15_000,
    }
  )

  const data = response.data as { data: Array<{ embedding: number[] }> }
  if (!data.data?.[0]?.embedding) {
    throw new Error('Invalid embedding API response')
  }
  return data.data[0].embedding
}

async function embed(text: string, config: AppConfig): Promise<number[]> {
  if (!_embConfig) {
    _embConfig = resolveEmbeddingConfig(config)
    getLogger().info('Embedding provider configured', {
      provider: _embConfig.provider,
      model: _embConfig.model,
      dimensions: _embConfig.dimensions,
    })
  }

  if (_embConfig.provider === 'local') {
    return deterministicEmbed(text)
  }

  try {
    return await embedViaAPI(text, _embConfig)
  } catch (err) {
    getLogger().warn('Embedding API failed, using local fallback', {
      provider: _embConfig.provider,
      error: err instanceof Error ? err.message : String(err),
    })
    return deterministicEmbed(text)
  }
}

/** Deterministic 384-dimension embedding based on character frequencies (fallback only) */
export async function deterministicEmbed(text: string): Promise<number[]> {
  const dim = 384
  const vec = new Array<number>(dim).fill(0)
  const normalized = text.toLowerCase()
  for (let i = 0; i < normalized.length; i++) {
    const code = normalized.charCodeAt(i)
    vec[code % dim] += 1
    // Add bigram influence for slightly better quality
    if (i > 0) {
      const prev = normalized.charCodeAt(i - 1)
      vec[(code * 31 + prev) % dim] += 0.5
    }
  }
  // L2 normalize
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1
  return vec.map(v => v / norm)
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length)
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1)
}

// Reset embedding config (for testing)
export function resetEmbeddingConfig(): void {
  _embConfig = null
}

// ── Supabase Strategy ─────────────────────────────────────────────────────────

class SupabaseStrategy implements MemoryStrategy {
  private client!: import('@supabase/supabase-js').SupabaseClient
  private config: AppConfig
  private clientReady: Promise<void>

  constructor(url: string, serviceKey: string, config: AppConfig) {
    this.config = config
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
    const embedding = await embed(content, this.config)
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
  private config: AppConfig
  private ready: Promise<void>

  constructor(dbPath: string, config: AppConfig) {
    this.config = config
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
    const embedding = await embed(content, this.config)
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
  private config: AppConfig

  constructor(strategy: MemoryStrategy, config: AppConfig) {
    this.strategy = strategy
    this.config = config
  }

  async insertMemory(content: string, metadata: Record<string, unknown> = {}): Promise<Memory> {
    const embedding = await embed(content, this.config)
    return this.strategy.insert(content, embedding, metadata)
  }

  async semanticSearch(query: string, topK = 5): Promise<Memory[]> {
    const queryEmbedding = await embed(query, this.config)
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
      config
    )
  } else {
    const { mkdirSync } = await import('fs')
    const { dirname } = await import('path')
    mkdirSync(dirname(config.sqlitePath), { recursive: true })
    strategy = new SQLiteStrategy(config.sqlitePath, config)
  }

  return new MemoryLayer(strategy, config)
}

// SQL migration for Supabase (run once in your Supabase dashboard):
export const SUPABASE_MIGRATION = `
-- Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- Memories table (dimensions depend on your embedding provider)
-- Use 1536 for OpenAI, 1024 for Voyage/Cohere, 768 for Gemini/Ollama
CREATE TABLE IF NOT EXISTS memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content TEXT NOT NULL,
  embedding vector(1536),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Similarity search function
CREATE OR REPLACE FUNCTION match_memories(
  query_embedding vector(1536),
  match_count INT DEFAULT 5
)
RETURNS TABLE (
  id UUID,
  content TEXT,
  embedding vector(1536),
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
