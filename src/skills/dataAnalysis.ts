import { createReadStream } from 'fs'
import { registerSkill } from './index.js'
import type { AgentContext, SkillResult } from '../types/index.js'
import { resolve } from 'path'
import { homedir } from 'os'

const WORKSPACE_ROOT = resolve(homedir(), 'jarvis-workspace')

registerSkill({
  name: 'data_analyze_csv',
  description: 'Parse and analyze a CSV file from ~/jarvis-workspace/. Returns summary statistics, column info, and optional filtered rows.',
  inputSchema: {
    type: 'object',
    properties: {
      filePath: { type: 'string', description: 'Relative path to CSV file within jarvis-workspace' },
      filterColumn: { type: 'string', description: 'Column name to filter on (optional)' },
      filterValue: { type: 'string', description: 'Value to match in filterColumn (optional)' },
      limit: { type: 'number', description: 'Max rows to include in output (default: 20)' },
    },
    required: ['filePath'],
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    const csvParser = await import('csv-parser')

    const fullPath = resolve(WORKSPACE_ROOT, String(input.filePath))
    if (!fullPath.startsWith(WORKSPACE_ROOT)) {
      return { output: 'Path traversal blocked', isError: true }
    }

    return new Promise(resolve => {
      const rows: Record<string, string>[] = []
      let columns: string[] = []
      let error: string | null = null

      const stream = createReadStream(fullPath)
        .pipe(csvParser.default())

      stream.on('headers', (headers: string[]) => { columns = headers })
      stream.on('data', (row: Record<string, string>) => { rows.push(row) })
      stream.on('error', (err: Error) => { error = err.message })
      stream.on('end', () => {
        if (error) {
          resolve({ output: `CSV parse error: ${error}`, isError: true })
          return
        }

        let data = rows
        if (input.filterColumn && input.filterValue) {
          const col = String(input.filterColumn)
          const val = String(input.filterValue).toLowerCase()
          data = rows.filter(r => String(r[col] ?? '').toLowerCase().includes(val))
        }

        const limit = Number(input.limit ?? 20)
        const sample = data.slice(0, limit)

        // Compute stats for numeric columns
        const stats: Record<string, { min: number; max: number; avg: number; count: number }> = {}
        for (const col of columns) {
          const nums = rows.map(r => parseFloat(r[col])).filter(n => !isNaN(n))
          if (nums.length > 0) {
            stats[col] = {
              min: Math.min(...nums),
              max: Math.max(...nums),
              avg: nums.reduce((a, b) => a + b, 0) / nums.length,
              count: nums.length,
            }
          }
        }

        const summary = [
          `Total rows: ${rows.length}`,
          `Columns: ${columns.join(', ')}`,
          '',
          'Numeric column stats:',
          ...Object.entries(stats).map(([col, s]) =>
            `  ${col}: min=${s.min.toFixed(2)}, max=${s.max.toFixed(2)}, avg=${s.avg.toFixed(2)}`
          ),
          '',
          `Showing ${sample.length} of ${data.length} rows:`,
          JSON.stringify(sample, null, 2).slice(0, 4000),
        ].join('\n')

        resolve({ output: summary, isError: false })
      })
    })
  },
})

registerSkill({
  name: 'data_analyze_json',
  description: 'Parse and summarize a JSON file from ~/jarvis-workspace/. Supports arrays of objects with automatic field analysis.',
  inputSchema: {
    type: 'object',
    properties: {
      filePath: { type: 'string', description: 'Relative path to JSON file within jarvis-workspace' },
      jsonPath: { type: 'string', description: 'Dot-notation path to drill into nested data (e.g. "data.items")' },
      limit: { type: 'number', description: 'Max items to show in output (default: 10)' },
    },
    required: ['filePath'],
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    try {
      const { readFile } = await import('fs/promises')
      const fullPath = resolve(WORKSPACE_ROOT, String(input.filePath))
      if (!fullPath.startsWith(WORKSPACE_ROOT)) {
        return { output: 'Path traversal blocked', isError: true }
      }

      const raw = await readFile(fullPath, 'utf-8')
      let data: unknown = JSON.parse(raw)

      // Navigate dot-notation path
      if (input.jsonPath) {
        const parts = String(input.jsonPath).split('.')
        for (const part of parts) {
          if (data && typeof data === 'object') {
            data = (data as Record<string, unknown>)[part]
          }
        }
      }

      const limit = Number(input.limit ?? 10)

      if (Array.isArray(data)) {
        const sample = data.slice(0, limit)
        const keys = data.length > 0 && typeof data[0] === 'object'
          ? Object.keys(data[0] as Record<string, unknown>)
          : []
        return {
          output: `Array with ${data.length} items.\nFields: ${keys.join(', ')}\n\nSample:\n${JSON.stringify(sample, null, 2).slice(0, 4000)}`,
          isError: false,
        }
      }

      return {
        output: JSON.stringify(data, null, 2).slice(0, 8000),
        isError: false,
      }
    } catch (err) {
      return { output: `JSON analysis error: ${(err as Error).message}`, isError: true }
    }
  },
})
