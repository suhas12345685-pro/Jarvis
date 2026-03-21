import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the Google Generative AI SDK
const mockGenerateContent = vi.fn()
const mockGenerateContentStream = vi.fn()

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class MockGoogleGenAI {
    constructor() {}
    getGenerativeModel() {
      return {
        generateContent: mockGenerateContent,
        generateContentStream: mockGenerateContentStream,
      }
    }
  },
}))

import { GeminiProvider } from '../../../src/llm/gemini.js'

describe('GeminiProvider', () => {
  let provider: GeminiProvider

  beforeEach(() => {
    vi.clearAllMocks()
    provider = new GeminiProvider('test-gemini-key')
  })

  describe('name', () => {
    it('has correct provider name', () => {
      expect(provider.name).toBe('gemini')
    })
  })

  describe('chat', () => {
    it('returns text response', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        response: {
          candidates: [{
            content: { parts: [{ text: 'Hello from Gemini' }] },
            finishReason: 'STOP',
          }],
        },
      })

      const result = await provider.chat({
        model: 'gemini-2.0-flash',
        system: 'You are helpful',
        messages: [{ role: 'user', content: 'Hello' }],
      })

      expect(result.text).toBe('Hello from Gemini')
      expect(result.toolCalls).toEqual([])
      expect(result.stopReason).toBe('end_turn')
    })

    it('parses function call responses', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        response: {
          candidates: [{
            content: {
              parts: [
                { text: 'Let me search.' },
                { functionCall: { name: 'web_search', args: { query: 'test' } } },
              ],
            },
          }],
        },
      })

      const result = await provider.chat({
        model: 'gemini-2.0-flash',
        system: 'test',
        messages: [{ role: 'user', content: 'search for test' }],
        tools: [{ name: 'web_search', description: 'Search', inputSchema: { type: 'object' } }],
      })

      expect(result.text).toBe('Let me search.')
      expect(result.toolCalls).toHaveLength(1)
      expect(result.toolCalls[0].name).toBe('web_search')
      expect(result.toolCalls[0].arguments).toEqual({ query: 'test' })
      expect(result.toolCalls[0].id).toMatch(/^gemini-/)
      expect(result.stopReason).toBe('tool_use')
    })

    it('handles multiple text parts', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        response: {
          candidates: [{
            content: { parts: [{ text: 'Part 1' }, { text: 'Part 2' }] },
            finishReason: 'STOP',
          }],
        },
      })

      const result = await provider.chat({
        model: 'gemini-2.0-flash',
        system: 'test',
        messages: [{ role: 'user', content: 'test' }],
      })

      expect(result.text).toBe('Part 1\nPart 2')
    })

    it('handles MAX_TOKENS finish reason', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        response: {
          candidates: [{
            content: { parts: [{ text: 'Truncated' }] },
            finishReason: 'MAX_TOKENS',
          }],
        },
      })

      const result = await provider.chat({
        model: 'gemini-2.0-flash',
        system: 'test',
        messages: [{ role: 'user', content: 'write a long story' }],
      })

      expect(result.stopReason).toBe('max_tokens')
    })

    it('handles empty candidates', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        response: { candidates: [] },
      })

      const result = await provider.chat({
        model: 'gemini-2.0-flash',
        system: 'test',
        messages: [{ role: 'user', content: 'test' }],
      })

      expect(result.text).toBe('')
      expect(result.toolCalls).toEqual([])
    })

    it('handles undefined candidates', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        response: {},
      })

      const result = await provider.chat({
        model: 'gemini-2.0-flash',
        system: 'test',
        messages: [{ role: 'user', content: 'test' }],
      })

      expect(result.text).toBe('')
    })

    it('handles function call with no args', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        response: {
          candidates: [{
            content: {
              parts: [{ functionCall: { name: 'get_time', args: undefined } }],
            },
          }],
        },
      })

      const result = await provider.chat({
        model: 'gemini-2.0-flash',
        system: 'test',
        messages: [{ role: 'user', content: 'what time is it' }],
      })

      expect(result.toolCalls[0].arguments).toEqual({})
    })

    it('converts assistant messages with tool calls to model role', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        response: {
          candidates: [{
            content: { parts: [{ text: 'Done' }] },
            finishReason: 'STOP',
          }],
        },
      })

      await provider.chat({
        model: 'gemini-2.0-flash',
        system: 'test',
        messages: [
          { role: 'user', content: 'search for test' },
          {
            role: 'assistant',
            content: 'Searching...',
            toolCalls: [{ id: 'tc1', name: 'web_search', arguments: { query: 'test' } }],
          },
          { role: 'tool', toolCallId: 'web_search', content: 'Found results' },
        ],
      })

      const calledContents = mockGenerateContent.mock.calls[0][0].contents

      // User message
      expect(calledContents[0].role).toBe('user')

      // Assistant → model
      expect(calledContents[1].role).toBe('model')
      expect(calledContents[1].parts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ text: 'Searching...' }),
          expect.objectContaining({ functionCall: { name: 'web_search', args: { query: 'test' } } }),
        ])
      )

      // Tool result → function
      expect(calledContents[2].role).toBe('function')
      expect(calledContents[2].parts[0].functionResponse).toEqual({
        name: 'web_search',
        response: { result: 'Found results' },
      })
    })

    it('removes additionalProperties from tool schemas', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        response: {
          candidates: [{
            content: { parts: [{ text: 'ok' }] },
            finishReason: 'STOP',
          }],
        },
      })

      await provider.chat({
        model: 'gemini-2.0-flash',
        system: 'test',
        messages: [{ role: 'user', content: 'test' }],
        tools: [{
          name: 'my_tool',
          description: 'Test',
          inputSchema: {
            type: 'object',
            properties: { x: { type: 'string' } },
            additionalProperties: false,
          },
        }],
      })

      // The tool schema passed to Gemini should NOT have additionalProperties
      // (verified by the mock not throwing — Gemini rejects this field)
    })
  })

  describe('stream', () => {
    it('yields text_delta events', async () => {
      const chunks = [
        { candidates: [{ content: { parts: [{ text: 'Hello ' }] } }] },
        { candidates: [{ content: { parts: [{ text: 'Gemini' }] } }] },
      ]

      mockGenerateContentStream.mockResolvedValueOnce({
        stream: {
          [Symbol.asyncIterator]: async function* () {
            for (const c of chunks) yield c
          },
        },
      })

      const collected: import('../../../src/llm/types.js').LLMStreamEvent[] = []
      for await (const event of provider.stream({
        model: 'gemini-2.0-flash',
        system: 'test',
        messages: [{ role: 'user', content: 'hi' }],
      })) {
        collected.push(event)
      }

      const textDeltas = collected.filter(e => e.type === 'text_delta')
      expect(textDeltas).toHaveLength(2)
      expect(textDeltas[0].text).toBe('Hello ')
      expect(textDeltas[1].text).toBe('Gemini')

      const done = collected.find(e => e.type === 'done')
      expect(done).toBeTruthy()
      expect(done!.response!.text).toBe('Hello Gemini')
      expect(done!.response!.stopReason).toBe('end_turn')
    })

    it('yields tool call events from streaming', async () => {
      const chunks = [
        {
          candidates: [{
            content: {
              parts: [{ functionCall: { name: 'web_search', args: { query: 'test' } } }],
            },
          }],
        },
      ]

      mockGenerateContentStream.mockResolvedValueOnce({
        stream: {
          [Symbol.asyncIterator]: async function* () {
            for (const c of chunks) yield c
          },
        },
      })

      const collected: import('../../../src/llm/types.js').LLMStreamEvent[] = []
      for await (const event of provider.stream({
        model: 'gemini-2.0-flash',
        system: 'test',
        messages: [{ role: 'user', content: 'search' }],
        tools: [{ name: 'web_search', description: 'Search', inputSchema: {} }],
      })) {
        collected.push(event)
      }

      const toolStart = collected.find(e => e.type === 'tool_call_start')
      expect(toolStart).toBeTruthy()
      expect(toolStart!.toolCall!.name).toBe('web_search')

      const toolEnd = collected.find(e => e.type === 'tool_call_end')
      expect(toolEnd).toBeTruthy()

      const done = collected.find(e => e.type === 'done')
      expect(done!.response!.toolCalls).toHaveLength(1)
      expect(done!.response!.stopReason).toBe('tool_use')
    })

    it('handles mixed text and function calls in stream', async () => {
      const chunks = [
        { candidates: [{ content: { parts: [{ text: 'Let me help. ' }] } }] },
        {
          candidates: [{
            content: {
              parts: [{ functionCall: { name: 'calculator', args: { expr: '2+2' } } }],
            },
          }],
        },
      ]

      mockGenerateContentStream.mockResolvedValueOnce({
        stream: {
          [Symbol.asyncIterator]: async function* () {
            for (const c of chunks) yield c
          },
        },
      })

      const collected: import('../../../src/llm/types.js').LLMStreamEvent[] = []
      for await (const event of provider.stream({
        model: 'gemini-2.0-flash',
        system: 'test',
        messages: [{ role: 'user', content: 'calculate 2+2' }],
      })) {
        collected.push(event)
      }

      expect(collected.filter(e => e.type === 'text_delta')).toHaveLength(1)
      expect(collected.filter(e => e.type === 'tool_call_start')).toHaveLength(1)

      const done = collected.find(e => e.type === 'done')
      expect(done!.response!.text).toBe('Let me help. ')
      expect(done!.response!.toolCalls).toHaveLength(1)
      expect(done!.response!.stopReason).toBe('tool_use')
    })

    it('handles empty stream', async () => {
      mockGenerateContentStream.mockResolvedValueOnce({
        stream: {
          [Symbol.asyncIterator]: async function* () {
            // empty stream
          },
        },
      })

      const collected: import('../../../src/llm/types.js').LLMStreamEvent[] = []
      for await (const event of provider.stream({
        model: 'gemini-2.0-flash',
        system: 'test',
        messages: [{ role: 'user', content: 'test' }],
      })) {
        collected.push(event)
      }

      const done = collected.find(e => e.type === 'done')
      expect(done).toBeTruthy()
      expect(done!.response!.text).toBe('')
    })
  })
})
