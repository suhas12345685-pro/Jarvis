/**
 * Database skills — query SQL databases, inspect schemas, list tables.
 * Supports PostgreSQL, MySQL, SQLite via connection string.
 */
import { registerSkill } from './index.js'
import type { AgentContext, SkillResult } from '../types/index.js'
import { getLogger } from '../logger.js'

registerSkill({
  name: 'db_query',
  description: 'Execute a SQL query against a database. Supports PostgreSQL, MySQL, and SQLite. Returns results as JSON.',
  inputSchema: {
    type: 'object',
    properties: {
      connection_string: {
        type: 'string',
        description: 'Database connection string (e.g., postgresql://user:pass@host:5432/db, mysql://..., or sqlite:///path/to/file.db)',
      },
      query: { type: 'string', description: 'SQL query to execute' },
      params: {
        type: 'array',
        description: 'Query parameters for prepared statements',
        items: {},
      },
    },
    required: ['connection_string', 'query'],
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    const logger = getLogger()
    const connStr = String(input.connection_string)
    const query = String(input.query)
    const params = (input.params as unknown[]) || []

    // Block destructive operations without explicit confirmation marker
    const destructive = /^\s*(DROP|TRUNCATE|DELETE\s+FROM\s+\w+\s*$)/i
    if (destructive.test(query)) {
      return { output: 'BLOCKED: Destructive SQL without WHERE clause. Add a WHERE clause or confirm explicitly.', isError: true }
    }

    try {
      if (connStr.startsWith('sqlite')) {
        const path = connStr.replace(/^sqlite:\/\/\/?/, '')
        const { default: Database } = await import('better-sqlite3')
        const db = new Database(path, { readonly: query.trim().toUpperCase().startsWith('SELECT') })
        try {
          if (query.trim().toUpperCase().startsWith('SELECT') || query.trim().toUpperCase().startsWith('PRAGMA') || query.trim().toUpperCase().startsWith('WITH')) {
            const rows = db.prepare(query).all(...params)
            return { output: JSON.stringify(rows, null, 2), isError: false, metadata: { rowCount: rows.length } }
          } else {
            const info = db.prepare(query).run(...params)
            return { output: JSON.stringify({ changes: info.changes, lastInsertRowid: String(info.lastInsertRowid) }), isError: false }
          }
        } finally {
          db.close()
        }
      }

      // For PostgreSQL/MySQL — use dynamic imports
      if (connStr.startsWith('postgresql') || connStr.startsWith('postgres')) {
        const { default: pg } = await import('pg')
        const client = new pg.Client({ connectionString: connStr })
        await client.connect()
        try {
          const result = await client.query(query, params)
          return {
            output: JSON.stringify(result.rows, null, 2),
            isError: false,
            metadata: { rowCount: result.rowCount },
          }
        } finally {
          await client.end()
        }
      }

      if (connStr.startsWith('mysql')) {
        const mysql = await import('mysql2/promise')
        const conn = await mysql.createConnection(connStr)
        try {
          const [rows] = await conn.execute(query, params)
          return { output: JSON.stringify(rows, null, 2), isError: false }
        } finally {
          await conn.end()
        }
      }

      return { output: `Unsupported database type. Use postgresql://, mysql://, or sqlite:/// connection strings.`, isError: true }
    } catch (err) {
      logger.error('db_query failed', { error: (err as Error).message })
      return { output: `Database error: ${(err as Error).message}`, isError: true }
    }
  },
})

registerSkill({
  name: 'db_schema',
  description: 'Describe the schema of a database table — columns, types, constraints.',
  inputSchema: {
    type: 'object',
    properties: {
      connection_string: { type: 'string', description: 'Database connection string' },
      table: { type: 'string', description: 'Table name to describe' },
    },
    required: ['connection_string', 'table'],
  },
  handler: async (input: Record<string, unknown>, ctx: AgentContext): Promise<SkillResult> => {
    const connStr = String(input.connection_string)
    const table = String(input.table).replace(/[^a-zA-Z0-9_]/g, '')

    let query: string
    if (connStr.startsWith('sqlite')) {
      query = `PRAGMA table_info(${table})`
    } else if (connStr.startsWith('postgresql') || connStr.startsWith('postgres')) {
      query = `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = '${table}' ORDER BY ordinal_position`
    } else if (connStr.startsWith('mysql')) {
      query = `DESCRIBE ${table}`
    } else {
      return { output: 'Unsupported database type', isError: true }
    }

    // Reuse db_query
    const dbQuery = (await import('./index.js')).getSkill('db_query')
    if (!dbQuery) return { output: 'db_query skill not found', isError: true }
    return dbQuery.handler({ connection_string: connStr, query }, ctx)
  },
})

registerSkill({
  name: 'db_list_tables',
  description: 'List all tables in a database.',
  inputSchema: {
    type: 'object',
    properties: {
      connection_string: { type: 'string', description: 'Database connection string' },
    },
    required: ['connection_string'],
  },
  handler: async (input: Record<string, unknown>, ctx: AgentContext): Promise<SkillResult> => {
    const connStr = String(input.connection_string)

    let query: string
    if (connStr.startsWith('sqlite')) {
      query = `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`
    } else if (connStr.startsWith('postgresql') || connStr.startsWith('postgres')) {
      query = `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
    } else if (connStr.startsWith('mysql')) {
      query = `SHOW TABLES`
    } else {
      return { output: 'Unsupported database type', isError: true }
    }

    const dbQuery = (await import('./index.js')).getSkill('db_query')
    if (!dbQuery) return { output: 'db_query skill not found', isError: true }
    return dbQuery.handler({ connection_string: connStr, query }, ctx)
  },
})
