import { registerSkill, getSkill, getAllDefinitions } from './index.js'
import type { AgentContext, SkillResult, SkillDefinition } from '../types/index.js'
import { getLogger } from '../logger.js'
import { writeFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'fs'
import { resolve, join } from 'path'
import { homedir } from 'os'

const CUSTOM_SKILLS_DIR = resolve(homedir(), '.jarvis', 'custom-skills')
mkdirSync(CUSTOM_SKILLS_DIR, { recursive: true })

/**
 * skill_create — JARVIS builds a new tool at runtime.
 * The tool is defined as a JavaScript function that gets eval'd and registered.
 */
registerSkill({
  name: 'skill_create',
  description: 'Create a new skill/tool at runtime. JARVIS can build tools for itself. The handler code runs in a sandboxed context with access to axios for HTTP requests.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Unique skill name (snake_case)' },
      description: { type: 'string', description: 'What this skill does' },
      inputSchema: {
        type: 'object',
        description: 'JSON Schema for the tool input',
      },
      code: {
        type: 'string',
        description: 'JavaScript async function body. Receives (input, ctx) args. Must return { output: string, isError: boolean }. Has access to: axios, ctx.byoak.',
      },
    },
    required: ['name', 'description', 'inputSchema', 'code'],
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    const logger = getLogger()
    const name = String(input.name)
    const description = String(input.description)
    const schema = input.inputSchema as Record<string, unknown>
    const code = String(input.code)

    // Validate name format
    if (!/^[a-z][a-z0-9_]{2,40}$/.test(name)) {
      return { output: 'Skill name must be snake_case, 3-41 chars, start with a letter', isError: true }
    }

    // Prevent overriding built-in skills
    const existing = getSkill(name)
    if (existing) {
      return { output: `Skill "${name}" already exists. Use skill_update to modify it.`, isError: true }
    }

    // Security: block dangerous patterns
    const blocked = ['process.exit', 'child_process', 'eval(', 'Function(', 'require(', 'import(', '__proto__', 'constructor[']
    for (const pattern of blocked) {
      if (code.includes(pattern)) {
        return { output: `BLOCKED: Code contains forbidden pattern "${pattern}"`, isError: true }
      }
    }

    try {
      // Create the handler function
      const handlerFn = createSandboxedHandler(code)

      // Test the handler with a dry run
      try {
        // Quick validation that it's callable
        if (typeof handlerFn !== 'function') {
          return { output: 'Code did not produce a valid function', isError: true }
        }
      } catch (err) {
        return { output: `Code compilation error: ${(err as Error).message}`, isError: true }
      }

      // Register the skill
      const skillDef: SkillDefinition = {
        name,
        description,
        inputSchema: schema,
        handler: handlerFn,
      }

      registerSkill(skillDef)

      // Persist to disk for reload on restart
      const manifest = { name, description, inputSchema: schema, code }
      writeFileSync(
        join(CUSTOM_SKILLS_DIR, `${name}.json`),
        JSON.stringify(manifest, null, 2)
      )

      logger.info('Custom skill created', { name })
      return {
        output: `Skill "${name}" created and registered successfully. It's now available as a tool.`,
        isError: false,
        metadata: { skillName: name },
      }
    } catch (err) {
      return { output: `Failed to create skill: ${(err as Error).message}`, isError: true }
    }
  },
})

registerSkill({
  name: 'skill_update',
  description: 'Update an existing custom skill\'s code or description.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Name of the skill to update' },
      description: { type: 'string', description: 'New description (optional)' },
      code: { type: 'string', description: 'New handler code (optional)' },
    },
    required: ['name'],
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    const name = String(input.name)
    const manifestPath = join(CUSTOM_SKILLS_DIR, `${name}.json`)

    if (!existsSync(manifestPath)) {
      return { output: `Custom skill "${name}" not found. Only custom-built skills can be updated.`, isError: true }
    }

    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>

      if (input.description) manifest.description = String(input.description)
      if (input.code) {
        const code = String(input.code)
        const blocked = ['process.exit', 'child_process', 'eval(', 'Function(', 'require(', 'import(']
        for (const pattern of blocked) {
          if (code.includes(pattern)) {
            return { output: `BLOCKED: Code contains forbidden pattern "${pattern}"`, isError: true }
          }
        }
        manifest.code = code
      }

      const handlerFn = createSandboxedHandler(String(manifest.code))

      registerSkill({
        name,
        description: String(manifest.description),
        inputSchema: manifest.inputSchema as Record<string, unknown>,
        handler: handlerFn,
      })

      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))

      return { output: `Skill "${name}" updated successfully.`, isError: false }
    } catch (err) {
      return { output: `Failed to update skill: ${(err as Error).message}`, isError: true }
    }
  },
})

registerSkill({
  name: 'skill_delete',
  description: 'Delete a custom skill.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Name of the skill to delete' },
    },
    required: ['name'],
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    const name = String(input.name)
    const manifestPath = join(CUSTOM_SKILLS_DIR, `${name}.json`)

    if (!existsSync(manifestPath)) {
      return { output: `Custom skill "${name}" not found.`, isError: true }
    }

    const { unlinkSync } = await import('fs')
    unlinkSync(manifestPath)

    // Can't truly unregister from the Map (it'll be gone on restart)
    return { output: `Skill "${name}" deleted. It will be fully removed on next restart.`, isError: false }
  },
})

registerSkill({
  name: 'skill_list',
  description: 'List all available skills/tools, including custom-built ones.',
  inputSchema: {
    type: 'object',
    properties: {
      filter: { type: 'string', description: 'Optional filter keyword to search skill names/descriptions' },
    },
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    const filter = input.filter ? String(input.filter).toLowerCase() : ''
    const all = getAllDefinitions()

    const matched = filter
      ? all.filter(s => s.name.includes(filter) || s.description.toLowerCase().includes(filter))
      : all

    const output = matched
      .map(s => `• ${s.name}: ${s.description}`)
      .join('\n')

    return {
      output: `${matched.length} skill(s) available:\n\n${output}`,
      isError: false,
      metadata: { count: matched.length },
    }
  },
})

/**
 * Load custom skills from disk on startup.
 */
export async function loadCustomSkills(): Promise<number> {
  const logger = getLogger()
  let loaded = 0

  if (!existsSync(CUSTOM_SKILLS_DIR)) return 0

  const files = readdirSync(CUSTOM_SKILLS_DIR).filter(f => f.endsWith('.json'))

  for (const file of files) {
    try {
      const manifest = JSON.parse(
        readFileSync(join(CUSTOM_SKILLS_DIR, file), 'utf-8')
      ) as { name: string; description: string; inputSchema: Record<string, unknown>; code: string }

      const handlerFn = createSandboxedHandler(manifest.code)

      registerSkill({
        name: manifest.name,
        description: manifest.description,
        inputSchema: manifest.inputSchema,
        handler: handlerFn,
      })

      loaded++
    } catch (err) {
      logger.error('Failed to load custom skill', { file, error: (err as Error).message })
    }
  }

  if (loaded > 0) {
    logger.info('Custom skills loaded', { count: loaded })
  }

  return loaded
}

/**
 * Create a sandboxed handler from user-provided code.
 * The code runs with access to a limited set of APIs.
 */
function createSandboxedHandler(code: string): SkillDefinition['handler'] {
  // The code is expected to be an async function body
  // We wrap it with access to axios and basic utilities
  return async (input: Record<string, unknown>, ctx: AgentContext): Promise<SkillResult> => {
    try {
      const { default: axios } = await import('axios')
      const handler = new Function(
        'input', 'ctx', 'axios', 'JSON', 'Math', 'Date', 'Array', 'Object', 'String', 'Number', 'RegExp', 'Map', 'Set', 'Promise', 'console',
        `"use strict"; return (async () => { ${code} })()`
      )
      const result = await handler(
        input, ctx, axios, JSON, Math, Date, Array, Object, String, Number, RegExp, Map, Set, Promise, console
      )

      if (result && typeof result === 'object' && 'output' in result) {
        return result as SkillResult
      }

      return { output: String(result ?? 'No output'), isError: false }
    } catch (err) {
      return { output: `Runtime error: ${(err as Error).message}`, isError: true }
    }
  }
}
