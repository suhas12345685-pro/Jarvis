import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import type { MemoryStrategy } from '../../src/memoryLayer.js'
import type { Memory } from '../../src/types/index.js'
import { randomUUID } from 'crypto'

// In-memory SQLite strategy for testing
class TestSQLiteStrategy implements MemoryStrategy {
  private db: Database.Database

  constructor() {
    this.db = new Database(':memory:')
    this.db.exec(`
      CREATE TABLE memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        embedding TEXT NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      )
    `)
  }

  async insert(content: string, embedding: number[], metadata: Record<string, unknown>): Promise<Memory> {
    const id = randomUUID()
    const createdAt = new Date()
    this.db.prepare('INSERT INTO memories VALUES (?, ?, ?, ?, ?)').run(
      id, content, JSON.stringify(embedding), JSON.stringify(metadata), createdAt.toISOString()
    )
    return { id, content, embedding, metadata, createdAt }
  }

  async search(_embedding: number[], topK: number): Promise<Memory[]> {
    interface Row { id: string; content: string; embedding: string; metadata: string; created_at: string }
    const rows = this.db.prepare('SELECT * FROM memories LIMIT ?').all(topK) as Row[]
    return rows.map(r => ({
      id: r.id,
      content: r.content,
      embedding: JSON.parse(r.embedding) as number[],
      metadata: JSON.parse(r.metadata) as Record<string, unknown>,
      createdAt: new Date(r.created_at),
    }))
  }

  async delete(id: string): Promise<void> {
    this.db.prepare('DELETE FROM memories WHERE id = ?').run(id)
  }

  async close(): Promise<void> {
    this.db.close()
  }
}

describe('MemoryLayer', () => {
  let strategy: TestSQLiteStrategy

  beforeEach(() => {
    strategy = new TestSQLiteStrategy()
  })

  it('inserts and retrieves a memory', async () => {
    const mem = await strategy.insert('test memory', [0.1, 0.2], { userId: 'u1' })
    expect(mem.content).toBe('test memory')
    expect(mem.id).toBeTruthy()

    const results = await strategy.search([0.1, 0.2], 5)
    expect(results).toHaveLength(1)
    expect(results[0].content).toBe('test memory')
  })

  it('respects topK limit', async () => {
    await strategy.insert('mem 1', [1, 0], {})
    await strategy.insert('mem 2', [0, 1], {})
    await strategy.insert('mem 3', [1, 1], {})

    const results = await strategy.search([1, 0], 2)
    expect(results.length).toBeLessThanOrEqual(2)
  })

  it('preserves metadata round-trip', async () => {
    const meta = { userId: 'alice', channel: 'slack', tags: ['urgent'] }
    await strategy.insert('meta test', [], meta)

    const results = await strategy.search([], 5)
    const found = results.find(r => r.content === 'meta test')
    expect(found?.metadata).toEqual(meta)
  })

  it('deletes a memory by id', async () => {
    const mem = await strategy.insert('to delete', [], {})
    await strategy.delete(mem.id)

    const results = await strategy.search([], 10)
    expect(results.find(r => r.id === mem.id)).toBeUndefined()
  })
})
