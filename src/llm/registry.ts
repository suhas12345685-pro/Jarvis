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
  deepseek: 'deepseek-chat',
  moonshot: 'moonshot-v1-128k',
  ollama: 'llama3.1',
  meta: 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo',
  perplexity: 'sonar-pro',
}

/**
 * Create an LLM provider from config.
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

  if (OPENAI_COMPAT_NAMES.has(provider)) {
    // Ollama runs locally and doesn't need an API key
    if (provider !== 'ollama' && !apiKey) {
      throw new Error(`${provider} API key is required`)
    }
    return new OpenAICompatProvider(provider, apiKey, baseUrl)
  }

  throw new Error(`Unknown LLM provider: ${provider}. Supported: anthropic, openai, gemini, xai, deepseek, moonshot, ollama, meta, perplexity`)
}
