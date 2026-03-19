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

  it('creates Ollama provider without API key', async () => {
    const { getProvider } = await import('../../../src/llm/registry.js')
    const provider = getProvider({ provider: 'ollama', model: 'llama3.1' })
    expect(provider.name).toBe('ollama')
  })

  it('throws for unknown provider', async () => {
    const { getProvider } = await import('../../../src/llm/registry.js')
    expect(() => getProvider({ provider: 'unknown' as never, model: 'test' })).toThrow('Unknown LLM provider')
  })

  it('throws for missing API key', async () => {
    const { getProvider } = await import('../../../src/llm/registry.js')
    expect(() => getProvider({ provider: 'anthropic', model: 'test' })).toThrow('API key is required')
  })

  it('has correct default models', async () => {
    const { DEFAULT_MODELS } = await import('../../../src/llm/registry.js')
    expect(DEFAULT_MODELS.anthropic).toBe('claude-sonnet-4-6')
    expect(DEFAULT_MODELS.openai).toBe('gpt-4o')
    expect(DEFAULT_MODELS.gemini).toBe('gemini-2.0-flash')
    expect(DEFAULT_MODELS.ollama).toBe('llama3.1')
  })

  it('all providers have stream method', async () => {
    const { getProvider } = await import('../../../src/llm/registry.js')

    const anthropic = getProvider({ provider: 'anthropic', model: 'test', apiKey: 'key' })
    expect(typeof anthropic.stream).toBe('function')

    const openai = getProvider({ provider: 'openai', model: 'test', apiKey: 'key' })
    expect(typeof openai.stream).toBe('function')

    const gemini = getProvider({ provider: 'gemini', model: 'test', apiKey: 'key' })
    expect(typeof gemini.stream).toBe('function')
  })
})
