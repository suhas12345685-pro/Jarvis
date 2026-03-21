import type { LLMProvider, LLMProviderConfig, LLMProviderName } from './types.js'
import { AnthropicProvider } from './anthropic.js'
import { OpenAICompatProvider, OPENAI_COMPAT_PROVIDERS } from './openai-compat.js'
import { GeminiProvider } from './gemini.js'

const OPENAI_COMPAT_NAMES = new Set<string>(Object.keys(OPENAI_COMPAT_PROVIDERS))

/** Default models for each provider */
export const DEFAULT_MODELS: Record<LLMProviderName, string> = {
  anthropic: 'claude-sonnet-4-6',
  openai: 'gpt-4o',
  gemini: 'gemini-2.0-flash',
  xai: 'grok-2-latest',
  grok: 'grok-2-latest',
  deepseek: 'deepseek-chat',
  moonshot: 'moonshot-v1-128k',
  ollama: 'llama3.1',
  meta: 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo',
  perplexity: 'sonar-pro',
  manus: 'manus-1',
}

/**
 * Create an LLM provider from config.
 * All providers implement the unified IMessageEngine (LLMProvider) interface.
 * Throws if the provider name is unknown or API key is missing.
 */
export function getProvider(config: LLMProviderConfig): LLMProvider {
  const { provider, apiKey, baseUrl } = config

  if (provider === 'anthropic') {
    if (!apiKey) throw new Error('Anthropic API key is required')
    return new AnthropicProvider(apiKey)
  }

  if (provider === 'gemini') {
    if (!apiKey) throw new Error('Gemini API key is required')
    return new GeminiProvider(apiKey)
  }

  // Manus — async task-based provider (lazy-loaded)
  if (provider === 'manus') {
    if (!apiKey) throw new Error('Manus API key is required')
    // Lazy-load to avoid top-level import of optional provider
    const { ManusProvider } = require('./providers/manus.js') as typeof import('./providers/manus.js')
    return new ManusProvider(apiKey)
  }

  // grok is an alias for xai with the OpenAI-compat layer
  if (provider === 'grok') {
    if (!apiKey) throw new Error('Grok (xAI) API key is required')
    return new OpenAICompatProvider('xai', apiKey, baseUrl)
  }

  if (OPENAI_COMPAT_NAMES.has(provider)) {
    // Ollama runs locally and doesn't need an API key
    if (provider !== 'ollama' && !apiKey) {
      throw new Error(`${provider} API key is required`)
    }
    return new OpenAICompatProvider(provider, apiKey, baseUrl)
  }

  throw new Error(
    `Unknown LLM provider: ${provider}. Supported: anthropic, openai, gemini, xai, grok, deepseek, moonshot, ollama, meta, perplexity, manus`
  )
}
