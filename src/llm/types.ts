export interface LLMMessage {
  role: 'user' | 'assistant' | 'tool'
  content: string
  toolCallId?: string
  toolCalls?: LLMToolCall[]
}

export interface LLMToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface LLMToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface LLMResponse {
  text: string
  toolCalls: LLMToolCall[]
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens'
}

export interface LLMChatOptions {
  model: string
  system: string
  messages: LLMMessage[]
  tools?: LLMToolDefinition[]
  maxTokens?: number
  signal?: AbortSignal
}

export interface LLMProvider {
  name: string
  chat(opts: LLMChatOptions): Promise<LLMResponse>
}

export type LLMProviderName =
  | 'anthropic'
  | 'openai'
  | 'gemini'
  | 'xai'
  | 'deepseek'
  | 'moonshot'
  | 'ollama'
  | 'meta'
  | 'perplexity'

export interface LLMProviderConfig {
  provider: LLMProviderName
  model: string
  apiKey?: string
  baseUrl?: string
}
