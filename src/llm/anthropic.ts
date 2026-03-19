import Anthropic from '@anthropic-ai/sdk'
import type { LLMProvider, LLMChatOptions, LLMResponse, LLMMessage, LLMToolCall, LLMStreamEvent } from './types.js'

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

  async *stream(opts: LLMChatOptions): AsyncIterable<LLMStreamEvent> {
    const messages = toAnthropicMessages(opts.messages)

    const tools = opts.tools?.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Tool['input_schema'],
    }))

    const stream = this.client.messages.stream({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 4096,
      system: opts.system,
      tools: tools && tools.length > 0 ? tools : undefined,
      messages,
    })

    let text = ''
    const toolCalls: LLMToolCall[] = []
    let currentToolId = ''
    let currentToolName = ''
    let currentToolArgs = ''

    for await (const event of stream) {
      if (event.type === 'content_block_start') {
        const block = event.content_block as { type: string; id?: string; name?: string; text?: string }
        if (block.type === 'tool_use') {
          currentToolId = block.id ?? ''
          currentToolName = block.name ?? ''
          currentToolArgs = ''
          yield { type: 'tool_call_start', toolCall: { id: currentToolId, name: currentToolName } }
        }
      } else if (event.type === 'content_block_delta') {
        const delta = event.delta as { type: string; text?: string; partial_json?: string }
        if (delta.type === 'text_delta' && delta.text) {
          text += delta.text
          yield { type: 'text_delta', text: delta.text }
        } else if (delta.type === 'input_json_delta' && delta.partial_json) {
          currentToolArgs += delta.partial_json
          yield { type: 'tool_call_delta', toolCall: { id: currentToolId, name: currentToolName } }
        }
      } else if (event.type === 'content_block_stop') {
        if (currentToolId) {
          const args = safeParseJSON(currentToolArgs)
          toolCalls.push({ id: currentToolId, name: currentToolName, arguments: args })
          yield { type: 'tool_call_end', toolCall: { id: currentToolId, name: currentToolName, arguments: args } }
          currentToolId = ''
          currentToolName = ''
          currentToolArgs = ''
        }
      }
    }

    const finalMessage = await stream.finalMessage()
    const stopReason: LLMResponse['stopReason'] =
      finalMessage.stop_reason === 'tool_use' || toolCalls.length > 0
        ? 'tool_use'
        : finalMessage.stop_reason === 'max_tokens'
          ? 'max_tokens'
          : 'end_turn'

    yield { type: 'done', response: { text, toolCalls, stopReason } }
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

function safeParseJSON(str: string): Record<string, unknown> {
  try {
    return JSON.parse(str) as Record<string, unknown>
  } catch {
    return {}
  }
}
