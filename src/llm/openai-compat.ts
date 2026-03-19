import OpenAI from 'openai'
import type { LLMProvider, LLMChatOptions, LLMResponse, LLMMessage, LLMToolCall, LLMStreamEvent } from './types.js'

/**
 * Provider defaults for OpenAI-compatible APIs.
 * All use the `openai` npm package with different baseURLs.
 */
export const OPENAI_COMPAT_PROVIDERS: Record<string, { baseURL: string; defaultModel: string }> = {
  openai:     { baseURL: 'https://api.openai.com/v1',    defaultModel: 'gpt-4o' },
  xai:        { baseURL: 'https://api.x.ai/v1',          defaultModel: 'grok-2-latest' },
  deepseek:   { baseURL: 'https://api.deepseek.com/v1',  defaultModel: 'deepseek-chat' },
  moonshot:   { baseURL: 'https://api.moonshot.cn/v1',    defaultModel: 'moonshot-v1-128k' },
  ollama:     { baseURL: 'http://localhost:11434/v1',     defaultModel: 'llama3.1' },
  meta:       { baseURL: 'https://api.together.xyz/v1',  defaultModel: 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo' },
  perplexity: { baseURL: 'https://api.perplexity.ai',    defaultModel: 'sonar-pro' },
}

export class OpenAICompatProvider implements LLMProvider {
  name: string
  private client: OpenAI

  constructor(providerName: string, apiKey?: string, baseUrl?: string) {
    this.name = providerName
    const defaults = OPENAI_COMPAT_PROVIDERS[providerName]
    const resolvedBaseURL = baseUrl ?? defaults?.baseURL ?? 'https://api.openai.com/v1'

    this.client = new OpenAI({
      apiKey: apiKey ?? (providerName === 'ollama' ? 'ollama' : undefined),
      baseURL: resolvedBaseURL,
    })
  }

  async chat(opts: LLMChatOptions): Promise<LLMResponse> {
    const messages = toOpenAIMessages(opts.system, opts.messages)

    const tools = opts.tools?.map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      },
    }))

    const response = await this.client.chat.completions.create({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 4096,
      messages,
      tools: tools && tools.length > 0 ? tools : undefined,
    })

    return fromOpenAIResponse(response)
  }

  async *stream(opts: LLMChatOptions): AsyncIterable<LLMStreamEvent> {
    const messages = toOpenAIMessages(opts.system, opts.messages)

    const tools = opts.tools?.map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      },
    }))

    const stream = await this.client.chat.completions.create({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 4096,
      messages,
      tools: tools && tools.length > 0 ? tools : undefined,
      stream: true,
    })

    let text = ''
    const toolCalls: LLMToolCall[] = []
    const activeToolCalls = new Map<number, { id: string; name: string; args: string }>()

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta
      if (!delta) continue

      if (delta.content) {
        text += delta.content
        yield { type: 'text_delta', text: delta.content }
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index
          if (!activeToolCalls.has(idx)) {
            activeToolCalls.set(idx, { id: tc.id ?? '', name: tc.function?.name ?? '', args: '' })
            yield { type: 'tool_call_start', toolCall: { id: tc.id, name: tc.function?.name } }
          }
          const active = activeToolCalls.get(idx)!
          if (tc.id) active.id = tc.id
          if (tc.function?.name) active.name = tc.function.name
          if (tc.function?.arguments) {
            active.args += tc.function.arguments
            yield { type: 'tool_call_delta', toolCall: { id: active.id, name: active.name } }
          }
        }
      }

      if (chunk.choices[0]?.finish_reason) {
        // Finalize all tool calls
        for (const [, active] of activeToolCalls) {
          const args = safeParseJSON(active.args)
          toolCalls.push({ id: active.id, name: active.name, arguments: args })
          yield { type: 'tool_call_end', toolCall: { id: active.id, name: active.name, arguments: args } }
        }

        const finishReason = chunk.choices[0].finish_reason
        const stopReason: LLMResponse['stopReason'] =
          finishReason === 'tool_calls' || toolCalls.length > 0
            ? 'tool_use'
            : finishReason === 'length'
              ? 'max_tokens'
              : 'end_turn'

        yield { type: 'done', response: { text, toolCalls, stopReason } }
      }
    }
  }
}

function toOpenAIMessages(
  system: string,
  messages: LLMMessage[]
): OpenAI.ChatCompletionMessageParam[] {
  const result: OpenAI.ChatCompletionMessageParam[] = []

  if (system) {
    result.push({ role: 'system', content: system })
  }

  for (const msg of messages) {
    if (msg.role === 'user') {
      result.push({ role: 'user', content: msg.content })
    } else if (msg.role === 'assistant') {
      const toolCalls = msg.toolCalls?.map(tc => ({
        id: tc.id,
        type: 'function' as const,
        function: {
          name: tc.name,
          arguments: JSON.stringify(tc.arguments),
        },
      }))
      result.push({
        role: 'assistant',
        content: msg.content || null,
        tool_calls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
      })
    } else if (msg.role === 'tool') {
      result.push({
        role: 'tool',
        tool_call_id: msg.toolCallId!,
        content: msg.content,
      })
    }
  }

  return result
}

function fromOpenAIResponse(response: OpenAI.ChatCompletion): LLMResponse {
  const choice = response.choices[0]
  if (!choice) {
    return { text: '', toolCalls: [], stopReason: 'end_turn' }
  }

  const text = choice.message.content ?? ''
  const toolCalls: LLMToolCall[] = (choice.message.tool_calls ?? []).map(tc => {
    const fn = (tc as { id: string; function: { name: string; arguments: string } }).function
    return {
      id: tc.id,
      name: fn.name,
      arguments: safeParseJSON(fn.arguments),
    }
  })

  let stopReason: LLMResponse['stopReason'] = 'end_turn'
  if (choice.finish_reason === 'tool_calls' || toolCalls.length > 0) {
    stopReason = 'tool_use'
  } else if (choice.finish_reason === 'length') {
    stopReason = 'max_tokens'
  }

  return { text, toolCalls, stopReason }
}

function safeParseJSON(str: string): Record<string, unknown> {
  try {
    return JSON.parse(str) as Record<string, unknown>
  } catch {
    return {}
  }
}
