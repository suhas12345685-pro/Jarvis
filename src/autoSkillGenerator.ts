/**
 * Auto-Skill Generator — JARVIS detects missing capabilities and generates tools on the fly.
 *
 * When the LLM attempts to call a tool that doesn't exist, or when it signals that it lacks
 * a capability, the auto-generator uses the LLM to write the tool code, registers it,
 * and retries the operation — all transparently.
 */
import { registerSkill, getSkill, getAllDefinitions } from './skills/index.js'
import type { SkillDefinition, SkillResult, AgentContext } from './types/index.js'
import type { AppConfig } from './types/index.js'
import { getProvider } from './llm/registry.js'
import { getByoakValue } from './config.js'
import { getLogger } from './logger.js'
import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { resolve, join } from 'path'
import { homedir } from 'os'

const AUTO_SKILLS_DIR = resolve(homedir(), '.jarvis', 'auto-skills')
mkdirSync(AUTO_SKILLS_DIR, { recursive: true })

const BLOCKED_PATTERNS = [
  'process.exit', 'child_process', 'eval(', 'Function(',
  'require(', 'import(', '__proto__', 'constructor[',
  'execSync', 'spawnSync', 'fs.rm', 'fs.unlink',
]

const MAX_GENERATION_ATTEMPTS = 2

interface GeneratedSkill {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  code: string
}

/**
 * Detect if the LLM response indicates a missing capability.
 * Returns the capability description if detected, null otherwise.
 */
export function detectMissingCapability(
  toolName: string,
  toolResult: string,
  isError: boolean
): string | null {
  // Case 1: Unknown tool — the tool loop already catches this
  if (isError && toolResult.startsWith('Unknown tool:')) {
    return toolName
  }
  return null
}

/**
 * Generate a skill definition using the LLM.
 */
async function generateSkillCode(
  config: AppConfig,
  capabilityDescription: string,
  desiredName: string,
  inputHint?: Record<string, unknown>
): Promise<GeneratedSkill | null> {
  const logger = getLogger()

  const apiKey = resolveApiKey(config)
  const provider = getProvider({
    provider: config.llmProvider,
    model: config.llmModel,
    apiKey,
  })

  const existingSkills = getAllDefinitions()
    .map(s => `- ${s.name}: ${s.description}`)
    .join('\n')

  const prompt = `You are JARVIS's auto-skill generator. Generate a new tool/skill.

REQUESTED CAPABILITY: "${capabilityDescription}"
DESIRED TOOL NAME: "${desiredName}"
${inputHint ? `INPUT HINT: ${JSON.stringify(inputHint)}` : ''}

EXISTING SKILLS (do not duplicate):
${existingSkills}

Generate a JSON object with EXACTLY this shape:
{
  "name": "snake_case_name",
  "description": "What this skill does (one sentence)",
  "inputSchema": {
    "type": "object",
    "properties": { ... },
    "required": [...]
  },
  "code": "async function body that receives (input, ctx) and returns { output: string, isError: boolean }"
}

RULES:
- The code is a JS async function body — NOT a full function declaration
- You have access to: input, ctx, axios, JSON, Math, Date, Array, Object, String, Number, RegExp, Map, Set, Promise, console
- axios is available for HTTP requests
- Return { output: string, isError: boolean }
- Keep it simple and practical
- NO require(), import(), eval(), child_process, process.exit
- Handle errors gracefully
- Return ONLY the JSON object, nothing else`

  try {
    const response = await provider.chat({
      model: config.llmModel,
      system: 'You are a code generator. Return ONLY valid JSON. No markdown fences, no explanation.',
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 4096,
    })

    const text = response.text.trim()
    // Extract JSON from response (handle potential markdown fences)
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      logger.error('Auto-skill generator: no JSON found in response')
      return null
    }

    const parsed = JSON.parse(jsonMatch[0]) as GeneratedSkill

    // Validate required fields
    if (!parsed.name || !parsed.description || !parsed.inputSchema || !parsed.code) {
      logger.error('Auto-skill generator: missing required fields')
      return null
    }

    // Security check
    for (const pattern of BLOCKED_PATTERNS) {
      if (parsed.code.includes(pattern)) {
        logger.warn('Auto-skill generator: blocked dangerous pattern', { pattern, skill: parsed.name })
        return null
      }
    }

    // Sanitize name
    parsed.name = parsed.name.replace(/[^a-z0-9_]/g, '_').slice(0, 41)
    if (!/^[a-z]/.test(parsed.name)) parsed.name = 'auto_' + parsed.name

    return parsed
  } catch (err) {
    logger.error('Auto-skill generation failed', { error: (err as Error).message })
    return null
  }
}

function resolveApiKey(config: AppConfig): string {
  if (config.llmProvider === 'anthropic') return config.anthropicApiKey
  const byoakKey = getByoakValue(config.byoak, config.llmProvider, 'API_KEY')
  if (byoakKey) return byoakKey
  if (config.llmProvider === 'ollama') return ''
  return config.anthropicApiKey
}

/**
 * Create a sandboxed handler from generated code.
 */
function createAutoHandler(code: string): SkillDefinition['handler'] {
  return async (input: Record<string, unknown>, ctx: AgentContext): Promise<SkillResult> => {
    try {
      const { default: axios } = await import('axios')
      const handler = new Function(
        'input', 'ctx', 'axios', 'JSON', 'Math', 'Date', 'Array', 'Object',
        'String', 'Number', 'RegExp', 'Map', 'Set', 'Promise', 'console',
        `"use strict"; return (async () => { ${code} })()`
      )
      const result = await handler(
        input, ctx, axios, JSON, Math, Date, Array, Object,
        String, Number, RegExp, Map, Set, Promise, console
      )

      if (result && typeof result === 'object' && 'output' in result) {
        return result as SkillResult
      }
      return { output: String(result ?? 'No output'), isError: false }
    } catch (err) {
      return { output: `Auto-skill runtime error: ${(err as Error).message}`, isError: true }
    }
  }
}

/**
 * Attempt to auto-generate and register a missing skill.
 * Returns true if the skill was created successfully.
 */
export async function autoGenerateSkill(
  config: AppConfig,
  toolName: string,
  inputHint?: Record<string, unknown>
): Promise<boolean> {
  const logger = getLogger()

  // Don't override existing skills
  if (getSkill(toolName)) {
    return false
  }

  logger.info('Auto-generating skill', { toolName })

  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt++) {
    const generated = await generateSkillCode(config, toolName, toolName, inputHint)
    if (!generated) continue

    try {
      const handler = createAutoHandler(generated.code)

      // Quick validation — ensure it's callable
      if (typeof handler !== 'function') continue

      const skillDef: SkillDefinition = {
        name: generated.name,
        description: `[Auto-generated] ${generated.description}`,
        inputSchema: generated.inputSchema,
        handler,
      }

      registerSkill(skillDef)

      // Persist for reload
      const manifest = {
        name: generated.name,
        description: generated.description,
        inputSchema: generated.inputSchema,
        code: generated.code,
        autoGenerated: true,
        generatedAt: new Date().toISOString(),
      }
      writeFileSync(
        join(AUTO_SKILLS_DIR, `${generated.name}.json`),
        JSON.stringify(manifest, null, 2)
      )

      logger.info('Auto-generated skill registered', { name: generated.name })
      return true
    } catch (err) {
      logger.error('Auto-skill registration failed', { attempt, error: (err as Error).message })
    }
  }

  logger.warn('Auto-skill generation exhausted attempts', { toolName })
  return false
}

/**
 * Load previously auto-generated skills from disk.
 */
export async function loadAutoSkills(): Promise<number> {
  const logger = getLogger()
  let loaded = 0

  if (!existsSync(AUTO_SKILLS_DIR)) return 0

  const { readdirSync, readFileSync } = await import('fs')
  const files = readdirSync(AUTO_SKILLS_DIR).filter(f => f.endsWith('.json'))

  for (const file of files) {
    try {
      const manifest = JSON.parse(
        readFileSync(join(AUTO_SKILLS_DIR, file), 'utf-8')
      ) as { name: string; description: string; inputSchema: Record<string, unknown>; code: string }

      // Skip if already registered
      if (getSkill(manifest.name)) continue

      const handler = createAutoHandler(manifest.code)

      registerSkill({
        name: manifest.name,
        description: `[Auto-generated] ${manifest.description}`,
        inputSchema: manifest.inputSchema,
        handler,
      })

      loaded++
    } catch (err) {
      logger.error('Failed to load auto-skill', { file, error: (err as Error).message })
    }
  }

  if (loaded > 0) {
    logger.info('Auto-generated skills loaded', { count: loaded })
  }

  return loaded
}

// Register the auto-generator as a skill itself so JARVIS can invoke it explicitly
registerSkill({
  name: 'auto_generate_skill',
  description: 'Automatically generate a new skill/tool using AI. JARVIS uses this when it needs a capability that doesn\'t exist yet.',
  inputSchema: {
    type: 'object',
    properties: {
      capability: {
        type: 'string',
        description: 'Description of the capability needed (e.g., "convert CSV to JSON", "check website uptime")',
      },
      suggested_name: {
        type: 'string',
        description: 'Suggested tool name in snake_case',
      },
    },
    required: ['capability', 'suggested_name'],
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    const logger = getLogger()
    const capability = String(input.capability)
    const suggestedName = String(input.suggested_name)

    // We need config to call the LLM — load it
    const { loadConfig } = await import('./config.js')
    let config: AppConfig
    try {
      config = loadConfig()
    } catch {
      return { output: 'Cannot auto-generate: config not available', isError: true }
    }

    const existing = getSkill(suggestedName)
    if (existing) {
      return { output: `Skill "${suggestedName}" already exists: ${existing.description}`, isError: true }
    }

    logger.info('Auto-generating skill via explicit request', { capability, suggestedName })

    const generated = await generateSkillCode(config, capability, suggestedName)
    if (!generated) {
      return { output: 'Failed to generate skill code. The AI could not produce valid code for this capability.', isError: true }
    }

    try {
      const handler = createAutoHandler(generated.code)
      registerSkill({
        name: generated.name,
        description: `[Auto-generated] ${generated.description}`,
        inputSchema: generated.inputSchema,
        handler,
      })

      // Persist
      writeFileSync(
        join(AUTO_SKILLS_DIR, `${generated.name}.json`),
        JSON.stringify({
          ...generated,
          autoGenerated: true,
          generatedAt: new Date().toISOString(),
        }, null, 2)
      )

      return {
        output: `Skill "${generated.name}" auto-generated and registered!\nDescription: ${generated.description}\nIt's now available as a tool.`,
        isError: false,
        metadata: { skillName: generated.name },
      }
    } catch (err) {
      return { output: `Failed to register auto-generated skill: ${(err as Error).message}`, isError: true }
    }
  },
})
