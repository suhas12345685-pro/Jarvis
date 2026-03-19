import { config as loadDotenv } from 'dotenv'
import { z } from 'zod'
import { homedir } from 'os'
import { resolve } from 'path'
import type { AppConfig, ByoakEntry } from './types/index.js'
import type { LLMProviderName } from './llm/types.js'

loadDotenv()

const LLM_PROVIDERS = [
  'anthropic', 'openai', 'gemini', 'xai', 'deepseek',
  'moonshot', 'ollama', 'meta', 'perplexity',
] as const

const AppConfigSchema = z.object({
  ANTHROPIC_API_KEY: z.string().default(''),
  LLM_PROVIDER: z.enum(LLM_PROVIDERS).default('anthropic'),
  LLM_MODEL: z.string().default(''),
  DB_MODE: z.enum(['supabase', 'sqlite']).default('sqlite'),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_KEY: z.string().optional(),
  SQLITE_PATH: z.string().default('~/.jarvis/jarvis.db'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  PORT: z.coerce.number().default(3000),
  LOG_PATH: z.string().default('~/.jarvis/logs/app.log'),
})

function resolveTilde(p: string): string {
  return p.startsWith('~/') ? resolve(homedir(), p.slice(2)) : p
}

function parseByoak(env: NodeJS.ProcessEnv): ByoakEntry[] {
  const entries: ByoakEntry[] = []
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith('BYOAK_') && value) {
      const parts = key.slice(6).split('_')
      if (parts.length >= 2) {
        entries.push({
          service: parts[0].toLowerCase(),
          keyName: parts.slice(1).join('_'),
          value,
        })
      }
    }
  }
  return entries
}

/** Resolve the API key for the selected LLM provider from BYOAK entries */
function resolveLLMApiKey(provider: LLMProviderName, anthropicKey: string, byoak: ByoakEntry[]): string {
  if (provider === 'anthropic') return anthropicKey

  const byoakKey = getByoakValue(byoak, provider, 'API_KEY')
  if (byoakKey) return byoakKey

  // Ollama doesn't need an API key
  if (provider === 'ollama') return ''

  return ''
}

function createConfig(): AppConfig {
  const result = AppConfigSchema.safeParse(process.env)

  if (!result.success) {
    const missing = result.error.issues.map(i => `  • ${i.path.join('.')}: ${i.message}`)
    throw new Error(`JARVIS configuration errors:\n${missing.join('\n')}\n\nRun "npm run setup" to configure.`)
  }

  const raw = result.data

  if (raw.DB_MODE === 'supabase') {
    if (!raw.SUPABASE_URL || !raw.SUPABASE_SERVICE_KEY) {
      throw new Error('DB_MODE=supabase requires SUPABASE_URL and SUPABASE_SERVICE_KEY')
    }
  }

  const byoak = parseByoak(process.env)
  const llmProvider = raw.LLM_PROVIDER
  const anthropicKey = raw.ANTHROPIC_API_KEY || resolveLLMApiKey('anthropic', '', byoak)

  // Import default models at runtime to avoid circular dependency
  const DEFAULT_MODELS: Record<string, string> = {
    anthropic: 'claude-sonnet-4-6',
    openai: 'gpt-4o',
    gemini: 'gemini-2.0-flash',
    xai: 'grok-2-latest',
    deepseek: 'deepseek-chat',
    moonshot: 'moonshot-v1-128k',
    ollama: 'llama3.1',
    meta: 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo',
    perplexity: 'sonar-pro',
  }

  return Object.freeze({
    anthropicApiKey: anthropicKey,
    llmProvider,
    llmModel: raw.LLM_MODEL || DEFAULT_MODELS[llmProvider] || 'claude-sonnet-4-6',
    dbMode: raw.DB_MODE,
    supabaseUrl: raw.SUPABASE_URL,
    supabaseServiceKey: raw.SUPABASE_SERVICE_KEY,
    sqlitePath: resolveTilde(raw.SQLITE_PATH),
    redisUrl: raw.REDIS_URL,
    port: raw.PORT,
    logPath: resolveTilde(raw.LOG_PATH),
    byoak,
  })
}

export function loadConfig(): AppConfig {
  return createConfig()
}

export function getByoakValue(
  byoak: ByoakEntry[],
  service: string,
  keyName: string
): string | undefined {
  return byoak.find(
    e => e.service === service.toLowerCase() && e.keyName === keyName.toUpperCase()
  )?.value
}
