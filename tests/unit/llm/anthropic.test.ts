import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the Anthropic SDK
const mockCreate = vi.fn()
const mockStream = vi.fn()

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      messages = {
        create: mockCreate,
        stream: mockStream,
      }
      constructor() {}
    },
  }
})

import { AnthropicProvider } from '../../../src/llm/anthropic.js'

describe('AnthropicProvider', () => {
  let provider: AnthropicProvider

  beforeEach(() => {
    vi.clearAllMocks()
    provider = new AnthropicProvider('test-api-key')
  })

  describe('chat', () => {
    it('converts messages and returns text response', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Hello from Claude' }],
        stop_reason: 'end_turn',
      })

      const result = await provider.chat({
        model: 'claude-sonnet-4-6',
        system: 'You are helpful',
        messages: [{ role: 'user', content: 'Hello' }],
      })

      expect(result.text).toBe('Hello from Claude')
      expect(result.toolCalls).toEqual([])
      expect(result.stopReason).toBe('end_turn')

      expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
        model: 'claude-sonnet-4-6',
        system: 'You are helpful',
        max_tokens: 4096,
      }))
    })

    it('parses tool_use response blocks', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [
          { type: 'text', text: 'Let me search for that.' },
          { type: 'tool_use', id: 'tc_1', name: 'web_search', input: { query: 'test' } },
        ],
        stop_reason: 'tool_use',
      })

      const result = await provider.chat({
        model: 'claude-sonnet-4-6',
        system: 'test',
        messages: [{ role: 'user', content: 'Search for test' }],
        tools: [{ name: 'web_search', description: 'Search', inputSchema: { type: 'object' } }],
      })

      expect(result.text).toBe('Let me search for that.')
      expect(result.toolCalls).toHaveLength(1)
      expect(result.toolCalls[0]).toEqual({
        id: 'tc_1',
        name: 'web_search',
        arguments: { query: 'test' },
      })
      expect(result.stopReason).toBe('tool_use')
    })

    it('handles multiple text blocks', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [
          { type: 'text', text: 'Part 1' },
          { type: 'text', text: 'Part 2' },
        ],
        stop_reason: 'end_turn',
      })

      const result = await provider.chat({
        model: 'test',
        system: 'test',
        messages: [{ role: 'user', content: 'test' }],
      })

      expect(result.text).toBe('Part 1\nPart 2')
    })

    it('handles max_tokens stop reason', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Truncated...' }],
        stop_reason: 'max_tokens',
      })

      const result = await provider.chat({
        model: 'test',
        system: 'test',
        messages: [{ role: 'user', content: 'test' }],
      })

      expect(result.stopReason).toBe('max_tokens')
    })

    it('converts tool result messages correctly', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Done' }],
        stop_reason: 'end_turn',
      })

      await provider.chat({
        model: 'test',
        system: 'test',
        messages: [
          { role: 'user', content: 'search for test' },
          {
            role: 'assistant',
            content: '',
            toolCalls: [{ id: 'tc_1', name: 'web_search', arguments: { query: 'test' } }],
          },
          { role: 'tool', toolCallId: 'tc_1', content: 'Found results' },
        ],
      })

      const calledMessages = mockCreate.mock.calls[0][0].messages
      // Tool result should become a user message with tool_result type
      const toolResultMsg = calledMessages.find(
        (m: any) => m.role === 'user' && Array.isArray(m.content) &&
        m.content.some((c: any) => c.type === 'tool_result')
      )
      expect(toolResultMsg).toBeTruthy()
    })

    it('passes tools when provided', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
      })

      await provider.chat({
        model: 'test',
        system: 'test',
        messages: [{ role: 'user', content: 'test' }],
        tools: [
          { name: 'my_tool', description: 'Does stuff', inputSchema: { type: 'object', properties: {} } },
        ],
      })

      const calledArgs = mockCreate.mock.calls[0][0]
      expect(calledArgs.tools).toHaveLength(1)
      expect(calledArgs.tools[0].name).toBe('my_tool')
      expect(calledArgs.tools[0].input_schema).toEqual({ type: 'object', properties: {} })
    })

    it('omits tools when none provided', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
      })

      await provider.chat({
        model: 'test',
        system: 'test',
        messages: [{ role: 'user', content: 'test' }],
      })

      expect(mockCreate.mock.calls[0][0].tools).toBeUndefined()
    })
  })

  describe('stream', () => {
    it('yields text_delta events', async () => {
      const events = [
        { type: 'content_block_start', content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello ' } },
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'world' } },
        { type: 'content_block_stop' },
      ]

      const asyncIter = {
        [Symbol.asyncIterator]: async function* () {
          for (const e of events) yield e
        },
      }

      const mockFinalMessage = vi.fn().mockResolvedValue({
        stop_reason: 'end_turn',
      })

      mockStream.mockReturnValueOnce({
        ...asyncIter,
        [Symbol.asyncIterator]: asyncIter[Symbol.asyncIterator],
        finalMessage: mockFinalMessage,
      })

      const collected: import('../../../src/llm/types.js').LLMStreamEvent[] = []
      for await (const event of provider.stream!({
        model: 'test',
        system: 'test',
        messages: [{ role: 'user', content: 'test' }],
      })) {
        collected.push(event)
      }

      const textDeltas = collected.filter(e => e.type === 'text_delta')
      expect(textDeltas).toHaveLength(2)
      expect(textDeltas[0].text).toBe('Hello ')
      expect(textDeltas[1].text).toBe('world')

      const done = collected.find(e => e.type === 'done')
      expect(done).toBeTruthy()
      expect(done!.response!.text).toBe('Hello world')
      expect(done!.response!.stopReason).toBe('end_turn')
    })

    it('yields tool call events', async () => {
      const events = [
        { type: 'content_block_start', content_block: { type: 'tool_use', id: 'tc_1', name: 'web_search' } },
        { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"query":' } },
        { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '"test"}' } },
        { type: 'content_block_stop' },
      ]

      const asyncIter = {
        [Symbol.asyncIterator]: async function* () {
          for (const e of events) yield e
        },
      }

      mockStream.mockReturnValueOnce({
        ...asyncIter,
        [Symbol.asyncIterator]: asyncIter[Symbol.asyncIterator],
        finalMessage: vi.fn().mockResolvedValue({ stop_reason: 'tool_use' }),
      })

      const collected: import('../../../src/llm/types.js').LLMStreamEvent[] = []
      for await (const event of provider.stream!({
        model: 'test',
        system: 'test',
        messages: [{ role: 'user', content: 'search' }],
        tools: [{ name: 'web_search', description: 'Search', inputSchema: { type: 'object' } }],
      })) {
        collected.push(event)
      }

      const toolStart = collected.find(e => e.type === 'tool_call_start')
      expect(toolStart).toBeTruthy()
      expect(toolStart!.toolCall!.name).toBe('web_search')

      const toolEnd = collected.find(e => e.type === 'tool_call_end')
      expect(toolEnd).toBeTruthy()
      expect(toolEnd!.toolCall!.arguments).toEqual({ query: 'test' })

      const done = collected.find(e => e.type === 'done')
      expect(done!.response!.toolCalls).toHaveLength(1)
      expect(done!.response!.stopReason).toBe('tool_use')
    })
  })

  describe('name', () => {
    it('has correct provider name', () => {
      expect(provider.name).toBe('anthropic')
    })
  })
})
