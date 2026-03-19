import Anthropic from '@anthropic-ai/sdk'
import type { LLMProvider, LLMChatOptions, LLMResponse, LLMMessage, LLMToolCall } from './types.js'

export class AnthropicProvider implements LLMProvider {
  name = 'anthropic'
  private client: Anthropic

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey })
  }

  async chat(opts: LLMChatOptions): Promise<LLMResponse> {
    const messages = toAnthropicMessages(opts.messages)

    const tools = opts.tools?.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Tool['input_schema'],
    }))

    const response = await this.client.messages.create({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 4096,
      system: opts.system,
      tools: tools && tools.length > 0 ? tools : undefined,
      messages,
    })

    return fromAnthropicResponse(response)
  }
}

function toAnthropicMessages(messages: LLMMessage[]): Anthropic.MessageParam[] {
  const result: Anthropic.MessageParam[] = []

  for (const msg of messages) {
    if (msg.role === 'user') {
      result.push({ role: 'user', content: msg.content })
    } else if (msg.role === 'assistant') {
      const content: Anthropic.ContentBlock[] = []
      if (msg.content) {
        content.push({ type: 'text', text: msg.content })
      }
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          content.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.name,
            input: tc.arguments,
          })
        }
      }
      result.push({ role: 'assistant', content })
    } else if (msg.role === 'tool') {
      // Tool results are sent as user messages in Anthropic format
      const last = result[result.length - 1]
      if (last?.role === 'user' && Array.isArray(last.content)) {
        (last.content as Anthropic.ToolResultBlockParam[]).push({
          type: 'tool_result',
          tool_use_id: msg.toolCallId!,
          content: msg.content,
        })
      } else {
        result.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: msg.toolCallId!,
              content: msg.content,
            },
          ],
        })
      }
    }
  }

  return result
}

function fromAnthropicResponse(response: Anthropic.Message): LLMResponse {
  let text = ''
  const toolCalls: LLMToolCall[] = []

  for (const block of response.content) {
    if (block.type === 'text') {
      text += (text ? '\n' : '') + block.text
    } else if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        name: block.name,
        arguments: block.input as Record<string, unknown>,
      })
    }
  }

  let stopReason: LLMResponse['stopReason'] = 'end_turn'
  if (response.stop_reason === 'tool_use' || toolCalls.length > 0) {
    stopReason = 'tool_use'
  } else if (response.stop_reason === 'max_tokens') {
    stopReason = 'max_tokens'
  }

  return { text, toolCalls, stopReason }
}
