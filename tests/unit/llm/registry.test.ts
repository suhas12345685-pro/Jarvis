import { describe, it, expect, vi } from 'vitest'

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: vi.fn(), stream: vi.fn() },
  })),
}))

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: { completions: { create: vi.fn() } },
  })),
}))

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
    getGenerativeModel: vi.fn().mockReturnValue({
      generateContent: vi.fn(),
      generateContentStream: vi.fn(),
    }),
  })),
}))

describe('LLM Registry', () => {
  it('creates Anthropic provider', async () => {
    const { getProvider } = await import('../../../src/llm/registry.js')
    const provider = getProvider({ provider: 'anthropic', model: 'claude-sonnet-4-6', apiKey: 'sk-ant-test' })
    expect(provider.name).toBe('anthropic')
  })

  it('creates OpenAI provider', async () => {
    const { getProvider } = await import('../../../src/llm/registry.js')
    const provider = getProvider({ provider: 'openai', model: 'gpt-4o', apiKey: 'sk-test' })
    expect(provider.name).toBe('openai')
  })

  it('creates Gemini provider', async () => {
    const { getProvider } = await import('../../../src/llm/registry.js')
    const provider = getProvider({ provider: 'gemini', model: 'gemini-2.0-flash', apiKey: 'AItest' })
    expect(provider.name).toBe('gemini')
  })

  it('creates DeepSeek provider (OpenAI-compat)', async () => {
    const { getProvider } = await import('../../../src/llm/registry.js')
    const provider = getProvider({ provider: 'deepseek', model: 'deepseek-chat', apiKey: 'sk-test' })
    expect(provider.name).toBe('deepseek')
  })

  it('creates xAI provider', async () => {
    const { getProvider } = await import('../../../src/llm/registry.js')
    const provider = getProvider({ provider: 'xai', model: 'grok-2-latest', apiKey: 'xai-test' })
    expect(provider.name).toBe('xai')
  })

  it('creates Moonshot provider', async () => {
    const { getProvider } = await import('../../../src/llm/registry.js')
    const provider = getProvider({ provider: 'moonshot', model: 'moonshot-v1-128k', apiKey: 'ms-test' })
    expect(provider.name).toBe('moonshot')
  })

  it('creates Perplexity provider', async () => {
    const { getProvider } = await import('../../../src/llm/registry.js')
    const provider = getProvider({ provider: 'perplexity', model: 'sonar-pro', apiKey: 'pplx-test' })
    expect(provider.name).toBe('perplexity')
  })

  it('creates Meta provider', async () => {
    const { getProvider } = await import('../../../src/llm/registry.js')
    const provider = getProvider({ provider: 'meta', model: 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo', apiKey: 'meta-test' })
    expect(provider.name).toBe('meta')
  })

  it('creates Ollama provider without API key', async () => {
    const { getProvider } = await import('../../../src/llm/registry.js')
    const provider = getProvider({ provider: 'ollama', model: 'llama3.1' })
    expect(provider.name).toBe('ollama')
  })

  it('throws for unknown provider', async () => {
    const { getProvider } = await import('../../../src/llm/registry.js')
    expect(() => getProvider({ provider: 'unknown' as never, model: 'test' })).toThrow('Unknown LLM provider')
  })

  it('throws for missing API key on anthropic', async () => {
    const { getProvider } = await import('../../../src/llm/registry.js')
    expect(() => getProvider({ provider: 'anthropic', model: 'test' })).toThrow('API key is required')
  })

  it('throws for missing API key on gemini', async () => {
    const { getProvider } = await import('../../../src/llm/registry.js')
    expect(() => getProvider({ provider: 'gemini', model: 'test' })).toThrow('API key is required')
  })

  it('throws for missing API key on OpenAI-compat providers', async () => {
    const { getProvider } = await import('../../../src/llm/registry.js')
    for (const name of ['openai', 'xai', 'deepseek', 'moonshot', 'meta', 'perplexity'] as const) {
      expect(() => getProvider({ provider: name, model: 'test' })).toThrow('API key is required')
    }
  })

  it('has correct default models for all providers', async () => {
    const { DEFAULT_MODELS } = await import('../../../src/llm/registry.js')
    expect(DEFAULT_MODELS.anthropic).toBe('claude-sonnet-4-6')
    expect(DEFAULT_MODELS.openai).toBe('gpt-4o')
    expect(DEFAULT_MODELS.gemini).toBe('gemini-2.0-flash')
    expect(DEFAULT_MODELS.xai).toBe('grok-2-latest')
    expect(DEFAULT_MODELS.deepseek).toBe('deepseek-chat')
    expect(DEFAULT_MODELS.moonshot).toBe('moonshot-v1-128k')
    expect(DEFAULT_MODELS.ollama).toBe('llama3.1')
    expect(DEFAULT_MODELS.meta).toBe('meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo')
    expect(DEFAULT_MODELS.perplexity).toBe('sonar-pro')
  })

  it('all providers have chat and stream methods', async () => {
    const { getProvider } = await import('../../../src/llm/registry.js')
    const providers = [
      { provider: 'anthropic' as const, apiKey: 'key' },
      { provider: 'openai' as const, apiKey: 'key' },
      { provider: 'gemini' as const, apiKey: 'key' },
      { provider: 'xai' as const, apiKey: 'key' },
      { provider: 'deepseek' as const, apiKey: 'key' },
      { provider: 'moonshot' as const, apiKey: 'key' },
      { provider: 'ollama' as const },
      { provider: 'meta' as const, apiKey: 'key' },
      { provider: 'perplexity' as const, apiKey: 'key' },
    ]

    for (const cfg of providers) {
      const p = getProvider({ ...cfg, model: 'test' })
      expect(typeof p.chat).toBe('function')
      expect(typeof p.stream).toBe('function')
      expect(p.name).toBe(cfg.provider)
    }
  })
})
