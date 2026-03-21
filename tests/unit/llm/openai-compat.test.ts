import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the OpenAI SDK
const mockCreate = vi.fn()

vi.mock('openai', () => {
  return {
    default: class MockOpenAI {
      chat = {
        completions: {
          create: mockCreate,
        },
      }
      constructor(opts: any) {
        // Store config for assertions
        ;(MockOpenAI as any)._lastConfig = opts
      }
      static _lastConfig: any = null
    },
  }
})

import { OpenAICompatProvider, OPENAI_COMPAT_PROVIDERS } from '../../../src/llm/openai-compat.js'

describe('OpenAICompatProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── Provider Configuration ──────────────────────────────────────────────

  describe('provider registry', () => {
    it('defines all 7 OpenAI-compatible providers', () => {
      const expected = ['openai', 'xai', 'deepseek', 'moonshot', 'ollama', 'meta', 'perplexity']
      for (const name of expected) {
        expect(OPENAI_COMPAT_PROVIDERS[name]).toBeDefined()
        expect(OPENAI_COMPAT_PROVIDERS[name].baseURL).toBeTruthy()
        expect(OPENAI_COMPAT_PROVIDERS[name].defaultModel).toBeTruthy()
      }
    })

    it('has correct base URLs', () => {
      expect(OPENAI_COMPAT_PROVIDERS.openai.baseURL).toBe('https://api.openai.com/v1')
      expect(OPENAI_COMPAT_PROVIDERS.xai.baseURL).toBe('https://api.x.ai/v1')
      expect(OPENAI_COMPAT_PROVIDERS.deepseek.baseURL).toBe('https://api.deepseek.com/v1')
      expect(OPENAI_COMPAT_PROVIDERS.moonshot.baseURL).toBe('https://api.moonshot.cn/v1')
      expect(OPENAI_COMPAT_PROVIDERS.ollama.baseURL).toBe('http://localhost:11434/v1')
      expect(OPENAI_COMPAT_PROVIDERS.meta.baseURL).toBe('https://api.together.xyz/v1')
      expect(OPENAI_COMPAT_PROVIDERS.perplexity.baseURL).toBe('https://api.perplexity.ai')
    })

    it('has correct default models', () => {
      expect(OPENAI_COMPAT_PROVIDERS.openai.defaultModel).toBe('gpt-4o')
      expect(OPENAI_COMPAT_PROVIDERS.xai.defaultModel).toBe('grok-2-latest')
      expect(OPENAI_COMPAT_PROVIDERS.deepseek.defaultModel).toBe('deepseek-chat')
      expect(OPENAI_COMPAT_PROVIDERS.moonshot.defaultModel).toBe('moonshot-v1-128k')
      expect(OPENAI_COMPAT_PROVIDERS.ollama.defaultModel).toBe('llama3.1')
      expect(OPENAI_COMPAT_PROVIDERS.meta.defaultModel).toBe('meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo')
      expect(OPENAI_COMPAT_PROVIDERS.perplexity.defaultModel).toBe('sonar-pro')
    })
  })

  // ── Provider Instantiation ──────────────────────────────────────────────

  describe('constructor', () => {
    it.each([
      ['openai', 'sk-openai-key'],
      ['xai', 'xai-key'],
      ['deepseek', 'sk-deepseek-key'],
      ['moonshot', 'sk-moonshot-key'],
      ['perplexity', 'pplx-key'],
      ['meta', 'meta-key'],
    ])('creates %s provider with correct name', (providerName, apiKey) => {
      const provider = new OpenAICompatProvider(providerName, apiKey)
      expect(provider.name).toBe(providerName)
    })

    it('creates ollama provider without API key', () => {
      const provider = new OpenAICompatProvider('ollama')
      expect(provider.name).toBe('ollama')
    })

    it('accepts custom base URL override', () => {
      const provider = new OpenAICompatProvider('openai', 'key', 'https://custom.api.com/v1')
      expect(provider.name).toBe('openai')
    })
  })

  // ── Chat Method (all providers share the same implementation) ───────────

  describe('chat', () => {
    let provider: OpenAICompatProvider

    beforeEach(() => {
      provider = new OpenAICompatProvider('openai', 'test-key')
    })

    it('returns text response on end_turn', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{
          message: { content: 'Hello from GPT', tool_calls: undefined },
          finish_reason: 'stop',
        }],
      })

      const result = await provider.chat({
        model: 'gpt-4o',
        system: 'You are helpful',
        messages: [{ role: 'user', content: 'Hello' }],
      })

      expect(result.text).toBe('Hello from GPT')
      expect(result.toolCalls).toEqual([])
      expect(result.stopReason).toBe('end_turn')
    })

    it('parses tool call responses', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{
          message: {
            content: 'Let me search.',
            tool_calls: [{
              id: 'call_abc123',
              type: 'function',
              function: { name: 'web_search', arguments: '{"query":"test"}' },
            }],
          },
          finish_reason: 'tool_calls',
        }],
      })

      const result = await provider.chat({
        model: 'gpt-4o',
        system: 'test',
        messages: [{ role: 'user', content: 'search for test' }],
        tools: [{ name: 'web_search', description: 'Search', inputSchema: { type: 'object' } }],
      })

      expect(result.toolCalls).toHaveLength(1)
      expect(result.toolCalls[0]).toEqual({
        id: 'call_abc123',
        name: 'web_search',
        arguments: { query: 'test' },
      })
      expect(result.stopReason).toBe('tool_use')
    })

    it('handles multiple tool calls', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{
          message: {
            content: null,
            tool_calls: [
              { id: 'tc1', type: 'function', function: { name: 'tool_a', arguments: '{"x":1}' } },
              { id: 'tc2', type: 'function', function: { name: 'tool_b', arguments: '{"y":2}' } },
            ],
          },
          finish_reason: 'tool_calls',
        }],
      })

      const result = await provider.chat({
        model: 'gpt-4o',
        system: 'test',
        messages: [{ role: 'user', content: 'do two things' }],
        tools: [
          { name: 'tool_a', description: 'A', inputSchema: {} },
          { name: 'tool_b', description: 'B', inputSchema: {} },
        ],
      })

      expect(result.toolCalls).toHaveLength(2)
      expect(result.toolCalls[0].name).toBe('tool_a')
      expect(result.toolCalls[1].name).toBe('tool_b')
    })

    it('handles max_tokens (length) stop reason', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{
          message: { content: 'Truncated...', tool_calls: undefined },
          finish_reason: 'length',
        }],
      })

      const result = await provider.chat({
        model: 'gpt-4o',
        system: 'test',
        messages: [{ role: 'user', content: 'write a very long story' }],
      })

      expect(result.stopReason).toBe('max_tokens')
    })

    it('handles empty choices gracefully', async () => {
      mockCreate.mockResolvedValueOnce({ choices: [] })

      const result = await provider.chat({
        model: 'gpt-4o',
        system: 'test',
        messages: [{ role: 'user', content: 'test' }],
      })

      expect(result.text).toBe('')
      expect(result.toolCalls).toEqual([])
      expect(result.stopReason).toBe('end_turn')
    })

    it('handles malformed tool arguments gracefully', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{
          message: {
            content: '',
            tool_calls: [{
              id: 'tc1',
              type: 'function',
              function: { name: 'test', arguments: 'not valid json{{{' },
            }],
          },
          finish_reason: 'tool_calls',
        }],
      })

      const result = await provider.chat({
        model: 'gpt-4o',
        system: 'test',
        messages: [{ role: 'user', content: 'test' }],
      })

      // safeParseJSON should return {} for invalid JSON
      expect(result.toolCalls[0].arguments).toEqual({})
    })

    it('converts system prompt, user, assistant, and tool messages', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{
          message: { content: 'Done', tool_calls: undefined },
          finish_reason: 'stop',
        }],
      })

      await provider.chat({
        model: 'gpt-4o',
        system: 'You are JARVIS',
        messages: [
          { role: 'user', content: 'search for test' },
          {
            role: 'assistant',
            content: 'Searching...',
            toolCalls: [{ id: 'tc1', name: 'web_search', arguments: { query: 'test' } }],
          },
          { role: 'tool', toolCallId: 'tc1', content: 'Found 5 results' },
        ],
      })

      const sentMessages = mockCreate.mock.calls[0][0].messages

      // System message first
      expect(sentMessages[0]).toEqual({ role: 'system', content: 'You are JARVIS' })

      // User message
      expect(sentMessages[1]).toEqual({ role: 'user', content: 'search for test' })

      // Assistant with tool calls
      expect(sentMessages[2].role).toBe('assistant')
      expect(sentMessages[2].tool_calls).toHaveLength(1)
      expect(sentMessages[2].tool_calls[0].function.name).toBe('web_search')

      // Tool result
      expect(sentMessages[3]).toEqual({
        role: 'tool',
        tool_call_id: 'tc1',
        content: 'Found 5 results',
      })
    })

    it('passes tools in OpenAI function format', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      })

      await provider.chat({
        model: 'gpt-4o',
        system: 'test',
        messages: [{ role: 'user', content: 'test' }],
        tools: [{
          name: 'my_tool',
          description: 'Does stuff',
          inputSchema: { type: 'object', properties: { x: { type: 'string' } } },
        }],
      })

      const calledArgs = mockCreate.mock.calls[0][0]
      expect(calledArgs.tools).toHaveLength(1)
      expect(calledArgs.tools[0].type).toBe('function')
      expect(calledArgs.tools[0].function.name).toBe('my_tool')
      expect(calledArgs.tools[0].function.description).toBe('Does stuff')
      expect(calledArgs.tools[0].function.parameters).toEqual({
        type: 'object',
        properties: { x: { type: 'string' } },
      })
    })

    it('omits tools when none provided', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      })

      await provider.chat({
        model: 'gpt-4o',
        system: 'test',
        messages: [{ role: 'user', content: 'test' }],
      })

      expect(mockCreate.mock.calls[0][0].tools).toBeUndefined()
    })

    it('uses default max_tokens of 4096', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      })

      await provider.chat({
        model: 'gpt-4o',
        system: 'test',
        messages: [{ role: 'user', content: 'test' }],
      })

      expect(mockCreate.mock.calls[0][0].max_tokens).toBe(4096)
    })

    it('respects custom max_tokens', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      })

      await provider.chat({
        model: 'gpt-4o',
        system: 'test',
        messages: [{ role: 'user', content: 'test' }],
        maxTokens: 1024,
      })

      expect(mockCreate.mock.calls[0][0].max_tokens).toBe(1024)
    })
  })

  // ── Streaming ───────────────────────────────────────────────────────────

  describe('stream', () => {
    let provider: OpenAICompatProvider

    beforeEach(() => {
      provider = new OpenAICompatProvider('openai', 'test-key')
    })

    it('yields text_delta events', async () => {
      const chunks = [
        { choices: [{ delta: { content: 'Hello ' }, finish_reason: null }] },
        { choices: [{ delta: { content: 'world' }, finish_reason: null }] },
        { choices: [{ delta: {}, finish_reason: 'stop' }] },
      ]

      mockCreate.mockResolvedValueOnce({
        [Symbol.asyncIterator]: async function* () {
          for (const c of chunks) yield c
        },
      })

      const collected: import('../../../src/llm/types.js').LLMStreamEvent[] = []
      for await (const event of provider.stream({
        model: 'gpt-4o',
        system: 'test',
        messages: [{ role: 'user', content: 'hi' }],
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

    it('yields tool call events from streaming', async () => {
      const chunks = [
        {
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                id: 'call_123',
                function: { name: 'web_search', arguments: '{"query":' },
              }],
            },
            finish_reason: null,
          }],
        },
        {
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                function: { arguments: '"test"}' },
              }],
            },
            finish_reason: null,
          }],
        },
        { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
      ]

      mockCreate.mockResolvedValueOnce({
        [Symbol.asyncIterator]: async function* () {
          for (const c of chunks) yield c
        },
      })

      const collected: import('../../../src/llm/types.js').LLMStreamEvent[] = []
      for await (const event of provider.stream({
        model: 'gpt-4o',
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
      expect(toolEnd!.toolCall!.arguments).toEqual({ query: 'test' })

      const done = collected.find(e => e.type === 'done')
      expect(done!.response!.toolCalls).toHaveLength(1)
      expect(done!.response!.stopReason).toBe('tool_use')
    })

    it('handles multiple concurrent tool calls in stream', async () => {
      const chunks = [
        {
          choices: [{
            delta: {
              tool_calls: [
                { index: 0, id: 'tc1', function: { name: 'tool_a', arguments: '{"a":1}' } },
                { index: 1, id: 'tc2', function: { name: 'tool_b', arguments: '{"b":2}' } },
              ],
            },
            finish_reason: null,
          }],
        },
        { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
      ]

      mockCreate.mockResolvedValueOnce({
        [Symbol.asyncIterator]: async function* () {
          for (const c of chunks) yield c
        },
      })

      const collected: import('../../../src/llm/types.js').LLMStreamEvent[] = []
      for await (const event of provider.stream({
        model: 'gpt-4o',
        system: 'test',
        messages: [{ role: 'user', content: 'do two things' }],
      })) {
        collected.push(event)
      }

      const done = collected.find(e => e.type === 'done')
      expect(done!.response!.toolCalls).toHaveLength(2)
      expect(done!.response!.toolCalls[0].name).toBe('tool_a')
      expect(done!.response!.toolCalls[1].name).toBe('tool_b')
    })

    it('sets stream:true in the API call', async () => {
      mockCreate.mockResolvedValueOnce({
        [Symbol.asyncIterator]: async function* () {
          yield { choices: [{ delta: { content: 'hi' }, finish_reason: 'stop' }] }
        },
      })

      const events: any[] = []
      for await (const e of provider.stream({
        model: 'gpt-4o',
        system: 'test',
        messages: [{ role: 'user', content: 'test' }],
      })) {
        events.push(e)
      }

      expect(mockCreate.mock.calls[0][0].stream).toBe(true)
    })
  })

  // ── Per-Provider Verification ───────────────────────────────────────────
  // Verify each provider can be instantiated and shares the same interface

  describe.each([
    ['openai', 'sk-openai-key', 'gpt-4o'],
    ['xai', 'xai-api-key', 'grok-2-latest'],
    ['deepseek', 'sk-deepseek-key', 'deepseek-chat'],
    ['moonshot', 'sk-moonshot-key', 'moonshot-v1-128k'],
    ['ollama', undefined, 'llama3.1'],
    ['meta', 'meta-together-key', 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo'],
    ['perplexity', 'pplx-api-key', 'sonar-pro'],
  ])('%s provider', (providerName, apiKey, defaultModel) => {
    it('instantiates with correct name', () => {
      const provider = new OpenAICompatProvider(providerName, apiKey)
      expect(provider.name).toBe(providerName)
    })

    it('has chat method', () => {
      const provider = new OpenAICompatProvider(providerName, apiKey)
      expect(typeof provider.chat).toBe('function')
    })

    it('has stream method', () => {
      const provider = new OpenAICompatProvider(providerName, apiKey)
      expect(typeof provider.stream).toBe('function')
    })

    it(`can make a chat call with model ${defaultModel}`, async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{
          message: { content: `Response from ${providerName}`, tool_calls: undefined },
          finish_reason: 'stop',
        }],
      })

      const provider = new OpenAICompatProvider(providerName, apiKey)
      const result = await provider.chat({
        model: defaultModel,
        system: 'test',
        messages: [{ role: 'user', content: 'Hello' }],
      })

      expect(result.text).toBe(`Response from ${providerName}`)
      expect(result.stopReason).toBe('end_turn')
      expect(mockCreate.mock.calls[0][0].model).toBe(defaultModel)
    })
  })
})
