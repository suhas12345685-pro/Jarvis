/**
 * Snippet manager skills — save, search, list, and run code snippets.
 * Persists snippets to ~/.jarvis/snippets/
 */
import { registerSkill } from './index.js'
import type { AgentContext, SkillResult } from '../types/index.js'
import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs'
import { resolve, join } from 'path'
import { homedir } from 'os'
import { execSync } from 'child_process'

const SNIPPETS_DIR = resolve(homedir(), '.jarvis', 'snippets')
mkdirSync(SNIPPETS_DIR, { recursive: true })

interface SnippetMeta {
  name: string
  description: string
  language: string
  tags: string[]
  code: string
  createdAt: string
  updatedAt: string
}

registerSkill({
  name: 'snippet_save',
  description: 'Save a reusable code snippet with metadata for later retrieval.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Unique snippet name (alphanumeric + dashes)' },
      code: { type: 'string', description: 'The code to save' },
      language: { type: 'string', description: 'Programming language (e.g., javascript, python, bash)' },
      description: { type: 'string', description: 'What this snippet does' },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Tags for searchability (e.g., ["api", "auth", "jwt"])',
      },
    },
    required: ['name', 'code', 'language'],
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    const name = String(input.name).replace(/[^a-zA-Z0-9\-_]/g, '-').slice(0, 64)
    const meta: SnippetMeta = {
      name,
      description: String(input.description || ''),
      language: String(input.language),
      tags: (input.tags as string[]) || [],
      code: String(input.code),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    // Check for existing
    const path = join(SNIPPETS_DIR, `${name}.json`)
    if (existsSync(path)) {
      const existing = JSON.parse(readFileSync(path, 'utf-8')) as SnippetMeta
      meta.createdAt = existing.createdAt
    }

    writeFileSync(path, JSON.stringify(meta, null, 2))

    return {
      output: `Snippet "${name}" saved (${meta.language}, ${meta.code.length} chars)`,
      isError: false,
    }
  },
})

registerSkill({
  name: 'snippet_search',
  description: 'Search saved snippets by name, language, tags, or description.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query (matches name, description, tags)' },
      language: { type: 'string', description: 'Filter by programming language' },
      tag: { type: 'string', description: 'Filter by tag' },
    },
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    const query = String(input.query || '').toLowerCase()
    const language = input.language ? String(input.language).toLowerCase() : ''
    const tag = input.tag ? String(input.tag).toLowerCase() : ''

    const files = readdirSync(SNIPPETS_DIR).filter(f => f.endsWith('.json'))
    const results: SnippetMeta[] = []

    for (const file of files) {
      try {
        const meta = JSON.parse(readFileSync(join(SNIPPETS_DIR, file), 'utf-8')) as SnippetMeta

        let match = true
        if (query && !meta.name.toLowerCase().includes(query) &&
            !meta.description.toLowerCase().includes(query) &&
            !meta.tags.some(t => t.toLowerCase().includes(query)) &&
            !meta.code.toLowerCase().includes(query)) {
          match = false
        }
        if (language && meta.language.toLowerCase() !== language) match = false
        if (tag && !meta.tags.some(t => t.toLowerCase() === tag)) match = false

        if (match) results.push(meta)
      } catch {
        // skip corrupt files
      }
    }

    if (results.length === 0) {
      return { output: 'No snippets found matching your criteria', isError: false }
    }

    const output = results.map(s => ({
      name: s.name,
      language: s.language,
      description: s.description,
      tags: s.tags,
      codePreview: s.code.slice(0, 200) + (s.code.length > 200 ? '...' : ''),
    }))

    return {
      output: JSON.stringify(output, null, 2),
      isError: false,
      metadata: { count: results.length },
    }
  },
})

registerSkill({
  name: 'snippet_get',
  description: 'Get the full code of a saved snippet by name.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Snippet name' },
    },
    required: ['name'],
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    const name = String(input.name)
    const path = join(SNIPPETS_DIR, `${name}.json`)

    if (!existsSync(path)) {
      return { output: `Snippet "${name}" not found`, isError: true }
    }

    const meta = JSON.parse(readFileSync(path, 'utf-8')) as SnippetMeta

    return {
      output: `# ${meta.name} (${meta.language})\n# ${meta.description}\n# Tags: ${meta.tags.join(', ')}\n\n${meta.code}`,
      isError: false,
      metadata: meta as unknown as Record<string, unknown>,
    }
  },
})

registerSkill({
  name: 'snippet_delete',
  description: 'Delete a saved snippet.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Snippet name to delete' },
    },
    required: ['name'],
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    const name = String(input.name)
    const path = join(SNIPPETS_DIR, `${name}.json`)

    if (!existsSync(path)) {
      return { output: `Snippet "${name}" not found`, isError: true }
    }

    unlinkSync(path)
    return { output: `Snippet "${name}" deleted`, isError: false }
  },
})

registerSkill({
  name: 'snippet_run',
  description: 'Execute a saved snippet. Supports bash, python, and node.js scripts.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Snippet name to run' },
      args: { type: 'string', description: 'Arguments to pass to the script' },
      timeout: { type: 'number', description: 'Execution timeout in seconds (default: 30)' },
    },
    required: ['name'],
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    const name = String(input.name)
    const args = String(input.args || '')
    const timeout = Number(input.timeout || 30) * 1000
    const path = join(SNIPPETS_DIR, `${name}.json`)

    if (!existsSync(path)) {
      return { output: `Snippet "${name}" not found`, isError: true }
    }

    const meta = JSON.parse(readFileSync(path, 'utf-8')) as SnippetMeta

    // Block dangerous operations
    const blocked = ['rm -rf', 'mkfs', 'dd if=', ':(){ ', 'fork bomb', 'shutdown', 'reboot']
    for (const pattern of blocked) {
      if (meta.code.includes(pattern)) {
        return { output: `BLOCKED: Snippet contains dangerous pattern "${pattern}"`, isError: true }
      }
    }

    try {
      let cmd: string
      switch (meta.language.toLowerCase()) {
        case 'bash': case 'sh': case 'shell':
          cmd = `bash -c '${meta.code.replace(/'/g, "'\\''")}' -- ${args}`
          break
        case 'python': case 'py':
          cmd = `python3 -c '${meta.code.replace(/'/g, "'\\''")}' ${args}`
          break
        case 'javascript': case 'js': case 'node':
          cmd = `node -e '${meta.code.replace(/'/g, "'\\''")}' ${args}`
          break
        default:
          return { output: `Cannot execute ${meta.language} snippets directly. Supported: bash, python, javascript.`, isError: true }
      }

      const output = execSync(cmd, {
        timeout,
        encoding: 'utf-8',
        maxBuffer: 1024 * 1024 * 5,
      }).trim()

      return { output: output || '(no output)', isError: false }
    } catch (err) {
      return { output: `Snippet execution error: ${(err as Error).message}`, isError: true }
    }
  },
})
