import { readFile, writeFile, appendFile, readdir, stat, lstat } from 'fs/promises'
import { resolve, join } from 'path'
import { homedir } from 'os'
import { mkdirSync } from 'fs'
import { registerSkill } from './index.js'
import type { AgentContext, SkillResult } from '../types/index.js'

const WORKSPACE_ROOT = resolve(homedir(), 'jarvis-workspace')
mkdirSync(WORKSPACE_ROOT, { recursive: true })

function safePath(userPath: string): string {
  const resolved = resolve(WORKSPACE_ROOT, userPath.replace(/^~\/jarvis-workspace\/?/, ''))
  if (!resolved.startsWith(WORKSPACE_ROOT)) {
    throw new Error(`Path traversal blocked: "${userPath}" resolves outside workspace`)
  }
  return resolved
}

registerSkill({
  name: 'file_read',
  description: 'Read the contents of a file within ~/jarvis-workspace/.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative path within the jarvis-workspace directory' },
    },
    required: ['path'],
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    try {
      const fullPath = safePath(String(input.path))
      const st = await lstat(fullPath)
      if (st.isSymbolicLink()) return { output: 'Error: symlinks not allowed', isError: true }
      const content = await readFile(fullPath, 'utf-8')
      return { output: content, isError: false }
    } catch (err) {
      return { output: `Read error: ${(err as Error).message}`, isError: true }
    }
  },
})

registerSkill({
  name: 'file_write',
  description: 'Write content to a file within ~/jarvis-workspace/ (overwrites if exists).',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative path within jarvis-workspace' },
      content: { type: 'string', description: 'Content to write' },
    },
    required: ['path', 'content'],
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    try {
      const fullPath = safePath(String(input.path))
      const { mkdirSync } = await import('fs')
      const { dirname } = await import('path')
      mkdirSync(dirname(fullPath), { recursive: true })
      await writeFile(fullPath, String(input.content), 'utf-8')
      return { output: `File written: ${fullPath}`, isError: false }
    } catch (err) {
      return { output: `Write error: ${(err as Error).message}`, isError: true }
    }
  },
})

registerSkill({
  name: 'file_append',
  description: 'Append content to a file within ~/jarvis-workspace/.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      content: { type: 'string' },
    },
    required: ['path', 'content'],
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    try {
      const fullPath = safePath(String(input.path))
      await appendFile(fullPath, String(input.content), 'utf-8')
      return { output: `Appended to: ${fullPath}`, isError: false }
    } catch (err) {
      return { output: `Append error: ${(err as Error).message}`, isError: true }
    }
  },
})

registerSkill({
  name: 'file_list',
  description: 'List files in a directory within ~/jarvis-workspace/.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative path (defaults to workspace root)' },
    },
    required: [],
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    try {
      const fullPath = safePath(String(input.path ?? '.'))
      const entries = await readdir(fullPath)
      const details = await Promise.all(
        entries.map(async e => {
          const st = await stat(join(fullPath, e)).catch(() => null)
          return `${st?.isDirectory() ? 'd' : '-'} ${e}`
        })
      )
      return { output: details.join('\n') || '(empty directory)', isError: false }
    } catch (err) {
      return { output: `List error: ${(err as Error).message}`, isError: true }
    }
  },
})

registerSkill({
  name: 'file_search',
  description: 'Search file contents using a regex pattern within ~/jarvis-workspace/.',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Regex pattern to search for' },
      path: { type: 'string', description: 'Directory to search in (default: workspace root)' },
    },
    required: ['pattern'],
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    try {
      const regex = new RegExp(String(input.pattern), 'gm')
      const searchRoot = safePath(String(input.path ?? '.'))
      const results: string[] = []

      async function searchDir(dir: string) {
        const entries = await readdir(dir)
        for (const entry of entries) {
          const fullPath = join(dir, entry)
          const st = await lstat(fullPath)
          if (st.isSymbolicLink()) continue
          if (st.isDirectory()) {
            await searchDir(fullPath)
          } else if (st.isFile()) {
            const content = await readFile(fullPath, 'utf-8').catch(() => '')
            const lines = content.split('\n')
            lines.forEach((line, i) => {
              if (regex.test(line)) {
                results.push(`${fullPath}:${i + 1}: ${line.trim()}`)
              }
            })
          }
        }
      }

      await searchDir(searchRoot)
      return {
        output: results.length > 0
          ? results.slice(0, 100).join('\n')
          : 'No matches found',
        isError: false,
      }
    } catch (err) {
      return { output: `Search error: ${(err as Error).message}`, isError: true }
    }
  },
})
