#!/usr/bin/env tsx
import * as p from '@clack/prompts'
import { writeFileSync, renameSync, chmodSync, existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import Anthropic from '@anthropic-ai/sdk'
import Stripe from 'stripe'

const ENV_PATH = resolve(process.cwd(), '.env')
const ENV_TMP = resolve(process.cwd(), '.env.tmp')

function loadExisting(): Record<string, string> {
  if (!existsSync(ENV_PATH)) return {}
  const lines = readFileSync(ENV_PATH, 'utf-8').split('\n')
  const result: Record<string, string> = {}
  for (const line of lines) {
    const eq = line.indexOf('=')
    if (eq > 0 && !line.startsWith('#')) {
      result[line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
    }
  }
  return result
}

function buildEnvFile(values: Record<string, string>): string {
  return Object.entries(values)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n') + '\n'
}

async function validateAnthropicKey(key: string): Promise<boolean> {
  try {
    const client = new Anthropic({ apiKey: key })
    await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'ping' }],
    })
    return true
  } catch {
    return false
  }
}

async function validateStripeKey(key: string): Promise<boolean> {
  try {
    const stripe = new Stripe(key)
    await stripe.balance.retrieve()
    return true
  } catch {
    return false
  }
}

async function main() {
  const existing = loadExisting()
  const env: Record<string, string> = { ...existing }

  p.intro('🤖  JARVIS Setup Wizard')

  // ── LLM Provider ───────────────────────────────────────────────────────────
  const llmProvider = await p.select({
    message: 'Primary LLM provider',
    options: [
      { value: 'anthropic', label: 'Anthropic (Claude)' },
      { value: 'openai', label: 'OpenAI (GPT-4o)' },
      { value: 'gemini', label: 'Google Gemini' },
      { value: 'xai', label: 'xAI (Grok)' },
      { value: 'deepseek', label: 'DeepSeek' },
      { value: 'moonshot', label: 'Moonshot / Kimi' },
      { value: 'ollama', label: 'Ollama (local)' },
      { value: 'meta', label: 'Meta / Llama (via Together AI)' },
      { value: 'perplexity', label: 'Perplexity AI' },
    ],
    initialValue: existing.LLM_PROVIDER ?? 'anthropic',
  })
  if (p.isCancel(llmProvider)) { p.cancel('Setup cancelled.'); process.exit(0) }
  env.LLM_PROVIDER = llmProvider as string

  // Model override (optional)
  const llmModel = await p.text({
    message: 'LLM model (leave blank for default)',
    placeholder: 'e.g. gpt-4o, claude-sonnet-4-6, gemini-2.0-flash',
    initialValue: existing.LLM_MODEL ?? '',
  })
  if (p.isCancel(llmModel)) { p.cancel('Setup cancelled.'); process.exit(0) }
  if ((llmModel as string).trim()) {
    env.LLM_MODEL = (llmModel as string).trim()
  }

  // ── DB Mode ───────────────────────────────────────────────────────────────
  const dbMode = await p.select({
    message: 'Database mode',
    options: [
      { value: 'sqlite', label: 'SQLite (local, private)' },
      { value: 'supabase', label: 'Supabase (cloud, multi-device sync)' },
    ],
    initialValue: existing.DB_MODE ?? 'sqlite',
  })
  if (p.isCancel(dbMode)) { p.cancel('Setup cancelled.'); process.exit(0) }
  env.DB_MODE = dbMode as string

  if (dbMode === 'supabase') {
    const supabaseUrl = await p.text({
      message: 'Supabase project URL',
      placeholder: 'https://your-project.supabase.co',
      initialValue: existing.SUPABASE_URL ?? '',
      validate: v => v.startsWith('https://') ? undefined : 'Must be a valid URL',
    })
    if (p.isCancel(supabaseUrl)) { p.cancel('Setup cancelled.'); process.exit(0) }
    env.SUPABASE_URL = supabaseUrl as string

    const supabaseKey = await p.password({
      message: 'Supabase service role key',
    })
    if (p.isCancel(supabaseKey)) { p.cancel('Setup cancelled.'); process.exit(0) }
    env.SUPABASE_SERVICE_KEY = supabaseKey as string
  } else {
    env.SQLITE_PATH = existing.SQLITE_PATH ?? '~/.jarvis/jarvis.db'
  }

  // ── LLM API Key ────────────────────────────────────────────────────────────
  if (llmProvider === 'anthropic') {
    const anthropicSpin = p.spinner()
    let anthropicKey = existing.ANTHROPIC_API_KEY ?? ''

    while (true) {
      const key = await p.password({
        message: `Anthropic API key${anthropicKey ? ' (press Enter to keep existing)' : ''}`,
      })
      if (p.isCancel(key)) { p.cancel('Setup cancelled.'); process.exit(0) }
      const input = (key as string).trim()
      const finalKey = input || anthropicKey

      if (!finalKey) { p.log.error('Anthropic API key is required'); continue }

      anthropicSpin.start('Validating Anthropic key…')
      const valid = await validateAnthropicKey(finalKey)
      if (valid) {
        anthropicSpin.stop('Anthropic key validated ✓')
        env.ANTHROPIC_API_KEY = finalKey
        break
      } else {
        anthropicSpin.stop('Invalid key — please try again')
      }
    }
  } else if (llmProvider !== 'ollama') {
    // For non-Anthropic, non-Ollama providers, collect their API key
    const providerNames: Record<string, string> = {
      openai: 'OpenAI', gemini: 'Google Gemini', xai: 'xAI',
      deepseek: 'DeepSeek', moonshot: 'Moonshot', meta: 'Together AI (Meta)',
      perplexity: 'Perplexity',
    }
    const providerLabel = providerNames[llmProvider as string] ?? llmProvider
    const byoakEnvKey = `BYOAK_${(llmProvider as string).toUpperCase()}_API_KEY`

    const apiKey = await p.password({
      message: `${providerLabel} API key`,
    })
    if (p.isCancel(apiKey)) { p.cancel('Setup cancelled.'); process.exit(0) }
    const v = (apiKey as string).trim()
    if (v) env[byoakEnvKey] = v
  }

  // ── Redis ─────────────────────────────────────────────────────────────────
  const redisUrl = await p.text({
    message: 'Redis URL',
    placeholder: 'redis://localhost:6379',
    initialValue: existing.REDIS_URL ?? 'redis://localhost:6379',
  })
  if (p.isCancel(redisUrl)) { p.cancel('Setup cancelled.'); process.exit(0) }
  env.REDIS_URL = redisUrl as string

  env.PORT = existing.PORT ?? '3000'
  env.LOG_PATH = existing.LOG_PATH ?? '~/.jarvis/logs/app.log'

  // ── BYOAK keys ────────────────────────────────────────────────────────────
  const addByoak = await p.confirm({
    message: 'Configure optional integration keys (channels, payments, etc.)?',
    initialValue: true,
  })
  if (!p.isCancel(addByoak) && addByoak) {
    await configureByoak(env, existing)
  }

  // ── Write .env ────────────────────────────────────────────────────────────
  writeFileSync(ENV_TMP, buildEnvFile(env), 'utf-8')
  renameSync(ENV_TMP, ENV_PATH)
  chmodSync(ENV_PATH, 0o600)

  p.outro('✅  JARVIS configured! Run "npm run dev" to start.')
}

async function configureByoak(
  env: Record<string, string>,
  existing: Record<string, string>
): Promise<void> {
  const services = [
    // ── Channels ──────────────────────────────────────────────────────
    {
      name: 'Slack',
      keys: [
        { env: 'BYOAK_SLACK_BOT_TOKEN', label: 'Bot token (xoxb-...)' },
        { env: 'BYOAK_SLACK_SIGNING_SECRET', label: 'Signing secret' },
        { env: 'BYOAK_SLACK_APP_TOKEN', label: 'App-level token (xapp-...)' },
      ],
    },
    {
      name: 'Telegram',
      keys: [
        { env: 'BYOAK_TELEGRAM_BOT_TOKEN', label: 'Bot token' },
        { env: 'BYOAK_TELEGRAM_WEBHOOK_SECRET', label: 'Webhook secret' },
      ],
    },
    {
      name: 'Discord',
      keys: [
        { env: 'BYOAK_DISCORD_BOT_TOKEN', label: 'Bot token' },
        { env: 'BYOAK_DISCORD_APPLICATION_ID', label: 'Application ID' },
      ],
    },
    {
      name: 'Google Chat',
      keys: [
        { env: 'BYOAK_GCHAT_SERVICE_ACCOUNT_KEY', label: 'Service account JSON key (paste JSON or file path)' },
      ],
    },
    // ── Voice ─────────────────────────────────────────────────────────
    {
      name: 'LiveKit (Voice)',
      keys: [
        { env: 'BYOAK_LIVEKIT_URL', label: 'LiveKit server URL (wss://...)' },
        { env: 'BYOAK_LIVEKIT_API_KEY', label: 'API key' },
        { env: 'BYOAK_LIVEKIT_API_SECRET', label: 'API secret' },
      ],
    },
    // ── Email & Calendar ──────────────────────────────────────────────
    {
      name: 'Email (SMTP/IMAP)',
      keys: [
        { env: 'BYOAK_EMAIL_SMTP_HOST', label: 'SMTP host' },
        { env: 'BYOAK_EMAIL_SMTP_PORT', label: 'SMTP port (587)' },
        { env: 'BYOAK_EMAIL_SMTP_USER', label: 'SMTP username' },
        { env: 'BYOAK_EMAIL_SMTP_PASS', label: 'SMTP password', password: true },
        { env: 'BYOAK_EMAIL_IMAP_HOST', label: 'IMAP host' },
        { env: 'BYOAK_EMAIL_IMAP_USER', label: 'IMAP username' },
        { env: 'BYOAK_EMAIL_IMAP_PASS', label: 'IMAP password', password: true },
      ],
    },
    {
      name: 'Google Calendar',
      keys: [
        { env: 'BYOAK_GCAL_CLIENT_ID', label: 'OAuth client ID' },
        { env: 'BYOAK_GCAL_CLIENT_SECRET', label: 'OAuth client secret', password: true },
        { env: 'BYOAK_GCAL_REFRESH_TOKEN', label: 'Refresh token', password: true },
      ],
    },
    // ── LLM API Keys (additional providers) ───────────────────────────
    {
      name: 'OpenAI',
      keys: [{ env: 'BYOAK_OPENAI_API_KEY', label: 'API key (sk-...)' }],
    },
    {
      name: 'Google Gemini',
      keys: [{ env: 'BYOAK_GEMINI_API_KEY', label: 'API key' }],
    },
    {
      name: 'xAI (Grok)',
      keys: [{ env: 'BYOAK_XAI_API_KEY', label: 'API key' }],
    },
    {
      name: 'DeepSeek',
      keys: [{ env: 'BYOAK_DEEPSEEK_API_KEY', label: 'API key' }],
    },
    {
      name: 'Moonshot / Kimi',
      keys: [{ env: 'BYOAK_MOONSHOT_API_KEY', label: 'API key' }],
    },
    {
      name: 'Perplexity AI',
      keys: [{ env: 'BYOAK_PERPLEXITY_API_KEY', label: 'API key' }],
    },
    {
      name: 'Meta / Llama (Together AI)',
      keys: [{ env: 'BYOAK_META_API_KEY', label: 'Together AI API key' }],
    },
    // ── Payments ──────────────────────────────────────────────────────
    {
      name: 'Stripe',
      keys: [
        { env: 'BYOAK_STRIPE_SECRET_KEY', label: 'Secret key (sk_live_... or sk_test_...)', password: true, validate: validateStripeKey },
      ],
    },
    {
      name: 'Razorpay',
      keys: [
        { env: 'BYOAK_RAZORPAY_KEY_ID', label: 'Key ID (rzp_...)' },
        { env: 'BYOAK_RAZORPAY_KEY_SECRET', label: 'Key Secret', password: true },
      ],
    },
    {
      name: 'PayPal',
      keys: [
        { env: 'BYOAK_PAYPAL_CLIENT_ID', label: 'Client ID' },
        { env: 'BYOAK_PAYPAL_CLIENT_SECRET', label: 'Client Secret', password: true },
        { env: 'BYOAK_PAYPAL_ENVIRONMENT', label: 'Environment (sandbox or live)' },
      ],
    },
  ]

  for (const service of services) {
    const enable = await p.confirm({
      message: `Enable ${service.name}?`,
      initialValue: service.keys.some(k => !!existing[k.env]),
    })
    if (p.isCancel(enable) || !enable) continue

    for (const keyDef of service.keys) {
      const prompt = keyDef.password
        ? p.password({ message: keyDef.label })
        : p.text({
            message: keyDef.label,
            initialValue: existing[keyDef.env] ?? '',
          })

      const value = await prompt
      if (p.isCancel(value)) continue
      const v = (value as string).trim()
      if (!v) continue

      if ('validate' in keyDef && typeof keyDef.validate === 'function') {
        const spin = p.spinner()
        spin.start(`Validating ${service.name} key…`)
        const ok = await (keyDef.validate as (k: string) => Promise<boolean>)(v)
        spin.stop(ok ? `${service.name} key validated ✓` : `${service.name} key invalid — saved anyway`)
      }

      env[keyDef.env] = v
    }
  }
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
