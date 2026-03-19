import { describe, it, expect, beforeEach, vi } from 'vitest'

describe('config', () => {
  beforeEach(() => {
    vi.resetModules()
    // Clear env
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.DB_MODE
    delete process.env.LLM_PROVIDER
    delete process.env.LLM_MODEL
  })

  it('defaults LLM_PROVIDER to anthropic when not set', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test'
    const { loadConfig } = await import('../../src/config.js')
    const config = loadConfig()
    expect(config.llmProvider).toBe('anthropic')
    expect(config.llmModel).toBe('claude-sonnet-4-6')
  })

  it('loads config with minimum required env vars', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test'
    const { loadConfig } = await import('../../src/config.js')
    const config = loadConfig()
    expect(config.anthropicApiKey).toBe('sk-ant-test')
    expect(config.dbMode).toBe('sqlite')
    expect(config.port).toBe(3000)
  })

  it('parses BYOAK entries correctly', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test'
    process.env.BYOAK_SLACK_BOT_TOKEN = 'xoxb-test'
    process.env.BYOAK_STRIPE_SECRET_KEY = 'sk_test_123'
    const { loadConfig } = await import('../../src/config.js')
    const config = loadConfig()

    const slackToken = config.byoak.find(e => e.service === 'slack' && e.keyName === 'BOT_TOKEN')
    expect(slackToken?.value).toBe('xoxb-test')

    const stripeKey = config.byoak.find(e => e.service === 'stripe' && e.keyName === 'SECRET_KEY')
    expect(stripeKey?.value).toBe('sk_test_123')

    delete process.env.BYOAK_SLACK_BOT_TOKEN
    delete process.env.BYOAK_STRIPE_SECRET_KEY
  })

  it('returns a frozen object', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test'
    const { loadConfig } = await import('../../src/config.js')
    const config = loadConfig()
    expect(Object.isFrozen(config)).toBe(true)
  })

  it('requires supabase credentials when DB_MODE=supabase', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test'
    process.env.DB_MODE = 'supabase'
    const { loadConfig } = await import('../../src/config.js')
    expect(() => loadConfig()).toThrow('SUPABASE_URL')
    delete process.env.DB_MODE
  })

  it('getByoakValue finds value by service and keyName', async () => {
    const { getByoakValue } = await import('../../src/config.js')
    const byoak = [{ service: 'stripe', keyName: 'SECRET_KEY', value: 'sk_test' }]
    expect(getByoakValue(byoak, 'stripe', 'SECRET_KEY')).toBe('sk_test')
    expect(getByoakValue(byoak, 'stripe', 'MISSING')).toBeUndefined()
    expect(getByoakValue(byoak, 'STRIPE', 'secret_key')).toBe('sk_test') // case insensitive
  })

  it('uses correct default model for each provider', async () => {
    process.env.LLM_PROVIDER = 'openai'
    const { loadConfig } = await import('../../src/config.js')
    const config = loadConfig()
    expect(config.llmProvider).toBe('openai')
    expect(config.llmModel).toBe('gpt-4o')
    delete process.env.LLM_PROVIDER
  })
})
