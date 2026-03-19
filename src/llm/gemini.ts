import { GoogleGenerativeAI, type Content, type FunctionDeclaration, type Part } from '@google/generative-ai'
import type { LLMProvider, LLMChatOptions, LLMResponse, LLMMessage, LLMToolCall, LLMStreamEvent } from './types.js'

export class GeminiProvider implements LLMProvider {
  name = 'gemini'
  private genAI: GoogleGenerativeAI

  constructor(apiKey: string) {
    this.genAI = new GoogleGenerativeAI(apiKey)
  }

  async chat(opts: LLMChatOptions): Promise<LLMResponse> {
    const tools = opts.tools?.map(t => ({
      name: t.name,
      description: t.description,
      parameters: toGeminiParameters(t.inputSchema),
    } as unknown as FunctionDeclaration))

    const model = this.genAI.getGenerativeModel({
      model: opts.model,
      systemInstruction: opts.system,
      tools: tools && tools.length > 0 ? [{ functionDeclarations: tools }] : undefined,
    })

    const contents = toGeminiContents(opts.messages)
    const result = await model.generateContent({ contents })
    const response = result.response

    return fromGeminiResponse(response)
  }

  async *stream(opts: LLMChatOptions): AsyncIterable<LLMStreamEvent> {
    const tools = opts.tools?.map(t => ({
      name: t.name,
      description: t.description,
      parameters: toGeminiParameters(t.inputSchema),
    } as unknown as FunctionDeclaration))

    const model = this.genAI.getGenerativeModel({
      model: opts.model,
      systemInstruction: opts.system,
      tools: tools && tools.length > 0 ? [{ functionDeclarations: tools }] : undefined,
    })

    const contents = toGeminiContents(opts.messages)
    const result = await model.generateContentStream({ contents })

    let fullText = ''
    const toolCalls: LLMToolCall[] = []

    for await (const chunk of result.stream) {
      const candidate = chunk.candidates?.[0]
      if (!candidate) continue

      for (const part of candidate.content.parts) {
        if ('text' in part && part.text) {
          fullText += part.text
          yield { type: 'text_delta', text: part.text }
        }
        if ('functionCall' in part && part.functionCall) {
          const tc: LLMToolCall = {
            id: `gemini-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            name: part.functionCall.name,
            arguments: (part.functionCall.args ?? {}) as Record<string, unknown>,
          }
          toolCalls.push(tc)
          yield { type: 'tool_call_start', toolCall: tc }
          yield { type: 'tool_call_end', toolCall: tc }
        }
      }
    }

    const stopReason: LLMResponse['stopReason'] =
      toolCalls.length > 0 ? 'tool_use' : 'end_turn'

    yield { type: 'done', response: { text: fullText, toolCalls, stopReason } }
  }
}

function toGeminiParameters(schema: Record<string, unknown>): Record<string, unknown> {
  // Gemini expects OpenAPI-style schemas — our inputSchema is already in that format
  const cleaned = { ...schema }
  // Remove 'additionalProperties' which Gemini doesn't support
  delete cleaned.additionalProperties
  return cleaned
}

function toGeminiContents(messages: LLMMessage[]): Content[] {
  const contents: Content[] = []

  for (const msg of messages) {
    if (msg.role === 'user') {
      contents.push({ role: 'user', parts: [{ text: msg.content }] })
    } else if (msg.role === 'assistant') {
      const parts: Part[] = []
      if (msg.content) {
        parts.push({ text: msg.content })
      }
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          parts.push({
            functionCall: { name: tc.name, args: tc.arguments },
          })
        }
      }
      contents.push({ role: 'model', parts })
    } else if (msg.role === 'tool') {
      contents.push({
        role: 'function',
        parts: [
          {
            functionResponse: {
              name: msg.toolCallId ?? 'unknown',
              response: { result: msg.content },
            },
          },
        ],
      })
    }
  }

  return contents
}

function fromGeminiResponse(response: { candidates?: Array<{ content: Content; finishReason?: string }> }): LLMResponse {
  const candidate = response.candidates?.[0]
  if (!candidate) {
    return { text: '', toolCalls: [], stopReason: 'end_turn' }
  }

  let text = ''
  const toolCalls: LLMToolCall[] = []

  for (const part of candidate.content.parts) {
    if ('text' in part && part.text) {
      text += (text ? '\n' : '') + part.text
    }
    if ('functionCall' in part && part.functionCall) {
      toolCalls.push({
        id: `gemini-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: part.functionCall.name,
        arguments: (part.functionCall.args ?? {}) as Record<string, unknown>,
      })
    }
  }

  let stopReason: LLMResponse['stopReason'] = 'end_turn'
  if (toolCalls.length > 0) {
    stopReason = 'tool_use'
  } else if (candidate.finishReason === 'MAX_TOKENS') {
    stopReason = 'max_tokens'
  }

  return { text, toolCalls, stopReason }
}
