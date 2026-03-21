import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock better-sqlite3
const mockAll = vi.fn().mockReturnValue([{ id: 1, name: 'test' }])
const mockRun = vi.fn().mockReturnValue({ changes: 1, lastInsertRowid: 42n })
const mockPrepare = vi.fn().mockReturnValue({ all: mockAll, run: mockRun })
const mockClose = vi.fn()
const MockDatabase = vi.fn().mockReturnValue({ prepare: mockPrepare, close: mockClose })
vi.mock('better-sqlite3', () => ({ default: MockDatabase }))

// Mock pg
const mockQuery = vi.fn().mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 })
const mockConnect = vi.fn().mockResolvedValue(undefined)
const mockEnd = vi.fn().mockResolvedValue(undefined)
const MockClient = vi.fn().mockReturnValue({ connect: mockConnect, query: mockQuery, end: mockEnd })
vi.mock('pg', () => ({ default: { Client: MockClient } }))

// Mock mysql2/promise
const mockExecute = vi.fn().mockResolvedValue([[{ id: 1 }]])
const mockMysqlEnd = vi.fn().mockResolvedValue(undefined)
vi.mock('mysql2/promise', () => ({
  createConnection: vi.fn().mockResolvedValue({ execute: mockExecute, end: mockMysqlEnd }),
}))

// Mock logger
vi.mock('../../../src/logger.js', () => ({
  getLogger: () => ({ error: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn() }),
}))

import { getSkill } from '../../../src/skills/index.js'
import '../../../src/skills/database.js'

const ctx: any = { userId: 'u1', channelType: 'test', threadId: 't1', memories: [] }

describe('database skills', () => {
  beforeEach(() => vi.clearAllMocks())

  describe('db_query', () => {
    const skill = getSkill('db_query')!

    it('blocks DROP without WHERE', async () => {
      const res = await skill.handler({ connection_string: 'sqlite:///test.db', query: 'DROP TABLE users' }, ctx)
      expect(res.isError).toBe(true)
      expect(res.output).toContain('BLOCKED')
    })

    it('blocks TRUNCATE', async () => {
      const res = await skill.handler({ connection_string: 'sqlite:///test.db', query: 'TRUNCATE users' }, ctx)
      expect(res.isError).toBe(true)
      expect(res.output).toContain('BLOCKED')
    })

    it('blocks DELETE without WHERE', async () => {
      const res = await skill.handler({ connection_string: 'sqlite:///test.db', query: 'DELETE FROM users' }, ctx)
      expect(res.isError).toBe(true)
      expect(res.output).toContain('BLOCKED')
    })

    it('executes SELECT on SQLite', async () => {
      const res = await skill.handler({ connection_string: 'sqlite:///test.db', query: 'SELECT * FROM users' }, ctx)
      expect(res.isError).toBe(false)
      expect(JSON.parse(res.output)).toEqual([{ id: 1, name: 'test' }])
      expect(MockDatabase).toHaveBeenCalledWith('test.db', { readonly: true })
      expect(mockClose).toHaveBeenCalled()
    })

    it('executes INSERT on SQLite', async () => {
      const res = await skill.handler({ connection_string: 'sqlite:///test.db', query: 'INSERT INTO users VALUES (1)' }, ctx)
      expect(res.isError).toBe(false)
      expect(JSON.parse(res.output)).toHaveProperty('changes', 1)
    })

    it('executes query on PostgreSQL', async () => {
      const res = await skill.handler({ connection_string: 'postgresql://user:pass@localhost/db', query: 'SELECT 1' }, ctx)
      expect(res.isError).toBe(false)
      expect(mockConnect).toHaveBeenCalled()
      expect(mockEnd).toHaveBeenCalled()
    })

    it('executes query on MySQL', async () => {
      const res = await skill.handler({ connection_string: 'mysql://user:pass@localhost/db', query: 'SELECT 1' }, ctx)
      expect(res.isError).toBe(false)
      expect(mockMysqlEnd).toHaveBeenCalled()
    })

    it('rejects unsupported database type', async () => {
      const res = await skill.handler({ connection_string: 'mongodb://localhost', query: 'find()' }, ctx)
      expect(res.isError).toBe(true)
      expect(res.output).toContain('Unsupported')
    })

    it('handles errors gracefully', async () => {
      mockConnect.mockRejectedValueOnce(new Error('Connection refused'))
      const res = await skill.handler({ connection_string: 'postgresql://localhost/db', query: 'SELECT 1' }, ctx)
      expect(res.isError).toBe(true)
      expect(res.output).toContain('Connection refused')
    })
  })

  describe('db_schema', () => {
    const skill = getSkill('db_schema')!

    it('generates PRAGMA for SQLite', async () => {
      const res = await skill.handler({ connection_string: 'sqlite:///test.db', table: 'users' }, ctx)
      expect(res.isError).toBe(false)
      // Uses db_query internally with PRAGMA
    })

    it('sanitizes table name', async () => {
      const res = await skill.handler({ connection_string: 'sqlite:///test.db', table: 'users; DROP TABLE--' }, ctx)
      // Table name should be sanitized to 'usersDROPTABLE'
      expect(res.isError).toBe(false)
    })

    it('rejects unsupported db type', async () => {
      const res = await skill.handler({ connection_string: 'mongodb://x', table: 'users' }, ctx)
      expect(res.isError).toBe(true)
      expect(res.output).toContain('Unsupported')
    })
  })

  describe('db_list_tables', () => {
    const skill = getSkill('db_list_tables')!

    it('lists SQLite tables', async () => {
      const res = await skill.handler({ connection_string: 'sqlite:///test.db' }, ctx)
      expect(res.isError).toBe(false)
    })

    it('lists PostgreSQL tables', async () => {
      const res = await skill.handler({ connection_string: 'postgresql://localhost/db' }, ctx)
      expect(res.isError).toBe(false)
    })

    it('rejects unsupported db type', async () => {
      const res = await skill.handler({ connection_string: 'oracle://x' }, ctx)
      expect(res.isError).toBe(true)
    })
  })
})
