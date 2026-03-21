import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock logger
vi.mock('../../../src/logger.js', () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

// Mock skill registry
const mockSkillHandler = vi.fn()
vi.mock('../../../src/skills/index.js', () => ({
  getSkill: (name: string) => {
    if (name === 'unknown_tool') return undefined
    return {
      name,
      description: `Mock skill ${name}`,
      handler: mockSkillHandler,
      inputSchema: {},
    }
  },
  getAllDefinitions: () => [],
}))

// Mock skill categories
vi.mock('../../../src/skills/skillCategories.js', () => ({
  classifyIntent: () => ['core', 'web'],
  getToolsForCategories: () => [
    { name: 'web_search', description: 'Search the web', inputSchema: {} },
    { name: 'send_email', description: 'Send an email', inputSchema: {} },
  ],
}))

// Mock memory classifier
vi.mock('../../../src/consciousness/memoryClassifier.js', () => ({
  classifyBatch: vi.fn().mockResolvedValue([
    { content: 'test', type: 'semantic', confidence: 0.9, tags: ['test'], importance: 0.5 },
  ]),
  classifyHeuristic: vi.fn().mockReturnValue({
    content: 'test', type: 'semantic', confidence: 0.5, tags: [], importance: 0.5,
  }),
}))

import { buildTaskGraph, executeReactLoop, runReactPipeline } from '../../../src/consciousness/reactLoop.js'
import type { AgentContext, AppConfig } from '../../../src/types/index.js'
import type { LLMProvider } from '../../../src/llm/types.js'

function createMockProvider(): LLMProvider {
  return {
    name: 'mock',
    chat: vi.fn(),
  }
}

function createMockCtx(): AgentContext {
  return {
    channelType: 'api',
    userId: 'test-user',
    threadId: 'test-thread',
    rawMessage: 'search the web and send email',
    memories: [],
    systemPrompt: 'You are JARVIS',
    byoak: [],
    sendInterim: vi.fn().mockResolvedValue(undefined),
    sendFinal: vi.fn().mockResolvedValue(undefined),
  }
}

function createMockConfig(): AppConfig {
  return {
    llmProvider: 'anthropic',
    llmModel: 'claude-sonnet-4-20250514',
    anthropicApiKey: 'test-key',
  } as AppConfig
}

describe('ReactLoop', () => {
  let provider: LLMProvider
  let ctx: AgentContext
  let config: AppConfig

  beforeEach(() => {
    vi.clearAllMocks()
    provider = createMockProvider()
    ctx = createMockCtx()
    config = createMockConfig()
  })

  describe('buildTaskGraph', () => {
    it('parses a multi-step plan from LLM', async () => {
      ;(provider.chat as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        text: `TASK: t1
DESCRIPTION: Search the web for latest news
DEPENDS: NONE

TASK: t2
DESCRIPTION: Summarize findings and send email
DEPENDS: t1`,
        toolCalls: [],
        stopReason: 'end_turn',
      })

      const graph = await buildTaskGraph('find news and email summary', provider, 'model')

      expect(graph.subTasks).toHaveLength(2)
      expect(graph.subTasks[0].id).toBe('t1')
      expect(graph.subTasks[0].dependencies).toHaveLength(0)
      expect(graph.subTasks[1].id).toBe('t2')
      expect(graph.subTasks[1].dependencies).toEqual(['t1'])
    })

    it('falls back to single task on LLM failure', async () => {
      ;(provider.chat as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('API down'))

      const graph = await buildTaskGraph('do something', provider, 'model')

      expect(graph.subTasks).toHaveLength(1)
      expect(graph.subTasks[0].description).toBe('do something')
    })

    it('falls back to single task on empty response', async () => {
      ;(provider.chat as ReturnType<typeof vi.fn>).mockResolvedValue({
        text: 'I cannot plan this.',
        toolCalls: [],
        stopReason: 'end_turn',
      })

      const graph = await buildTaskGraph('random goal', provider, 'model')
      expect(graph.subTasks).toHaveLength(1)
    })
  })

  describe('executeReactLoop', () => {
    it('completes a single-step task with ANSWER', async () => {
      const taskGraph = {
        goal: 'say hello',
        subTasks: [{
          id: 't1',
          description: 'Say hello to user',
          dependencies: [],
          status: 'pending' as const,
          stepsUsed: 0,
        }],
        memoryContext: '',
      }

      ;(provider.chat as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        text: 'THOUGHT: This is a simple greeting task.\nANSWER: Hello! How can I help you today?',
        toolCalls: [],
        stopReason: 'end_turn',
      })

      const result = await executeReactLoop(taskGraph, provider, 'model', ctx, config)

      expect(result.success).toBe(true)
      expect(result.finalAnswer).toContain('Hello')
      expect(result.totalStepsUsed).toBe(1)
    })

    it('executes a tool action and then answers', async () => {
      const taskGraph = {
        goal: 'search the web',
        subTasks: [{
          id: 't1',
          description: 'Search for Node.js news',
          dependencies: [],
          status: 'pending' as const,
          stepsUsed: 0,
        }],
        memoryContext: '',
      }

      // Step 1: Thought + Action
      ;(provider.chat as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        text: 'THOUGHT: I need to search the web.\nACTION: web_search\nINPUT: {"query": "Node.js news"}',
        toolCalls: [],
        stopReason: 'end_turn',
      })

      mockSkillHandler.mockResolvedValueOnce({
        output: 'Found 3 articles about Node.js 22 release',
        isError: false,
      })

      // Step 2: Answer
      ;(provider.chat as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        text: 'THOUGHT: I have the search results.\nANSWER: Found 3 articles about Node.js 22 release.',
        toolCalls: [],
        stopReason: 'end_turn',
      })

      const result = await executeReactLoop(taskGraph, provider, 'model', ctx, config)

      expect(result.success).toBe(true)
      expect(result.totalStepsUsed).toBe(2)
      expect(result.steps[0].action?.tool).toBe('web_search')
      expect(mockSkillHandler).toHaveBeenCalledOnce()
    })

    it('handles tool errors with recovery', async () => {
      const taskGraph = {
        goal: 'send email',
        subTasks: [{
          id: 't1',
          description: 'Send an email',
          dependencies: [],
          status: 'pending' as const,
          stepsUsed: 0,
        }],
        memoryContext: '',
      }

      // Step 1: Try to send email (fails)
      ;(provider.chat as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        text: 'THOUGHT: I need to send the email.\nACTION: send_email\nINPUT: {"to": "test@example.com"}',
        toolCalls: [],
        stopReason: 'end_turn',
      })

      mockSkillHandler.mockRejectedValueOnce(new Error('SMTP connection failed'))

      // Step 2: Recovery — try again or answer
      ;(provider.chat as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        text: 'THOUGHT: The email failed. I should report the error.\nANSWER: Email sending failed due to SMTP connection error.',
        toolCalls: [],
        stopReason: 'end_turn',
      })

      const result = await executeReactLoop(taskGraph, provider, 'model', ctx, config)

      expect(result.steps[0].isError).toBe(true)
      expect(result.steps[0].observation).toContain('SMTP')
      expect(result.totalStepsUsed).toBe(2)
    })

    it('skips sub-tasks when dependencies fail', async () => {
      const taskGraph = {
        goal: 'search and email',
        subTasks: [
          { id: 't1', description: 'Search web', dependencies: [], status: 'pending' as const, stepsUsed: 0 },
          { id: 't2', description: 'Send email', dependencies: ['t1'], status: 'pending' as const, stepsUsed: 0 },
        ],
        memoryContext: '',
      }

      // t1 fails completely
      ;(provider.chat as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('LLM error'))

      const result = await executeReactLoop(taskGraph, provider, 'model', ctx, config)

      expect(taskGraph.subTasks[0].status).toBe('failed')
      expect(taskGraph.subTasks[1].status).toBe('skipped')
      expect(taskGraph.subTasks[1].error).toBe('Dependency failed')
    })

    it('respects the 15-step budget', async () => {
      const taskGraph = {
        goal: 'infinite loop',
        subTasks: [{
          id: 't1',
          description: 'Never-ending task',
          dependencies: [],
          status: 'pending' as const,
          stepsUsed: 0,
        }],
        memoryContext: '',
      }

      // Always return an action, never an answer
      ;(provider.chat as ReturnType<typeof vi.fn>).mockResolvedValue({
        text: 'THOUGHT: Need to keep going.\nACTION: web_search\nINPUT: {"query": "more"}',
        toolCalls: [],
        stopReason: 'end_turn',
      })

      mockSkillHandler.mockResolvedValue({
        output: 'Results...',
        isError: false,
      })

      const result = await executeReactLoop(taskGraph, provider, 'model', ctx, config)

      expect(result.totalStepsUsed).toBeLessThanOrEqual(15)
      expect(result.success).toBe(false)
    })
  })

  describe('runReactPipeline', () => {
    it('runs the full plan → execute → save pipeline', async () => {
      // Plan call
      ;(provider.chat as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        text: 'TASK: t1\nDESCRIPTION: Greet the user\nDEPENDS: NONE',
        toolCalls: [],
        stopReason: 'end_turn',
      })

      // Execute call — direct answer
      ;(provider.chat as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        text: 'THOUGHT: Simple greeting.\nANSWER: Hello there!',
        toolCalls: [],
        stopReason: 'end_turn',
      })

      const result = await runReactPipeline('greet user', provider, 'model', ctx, config)

      expect(result.success).toBe(true)
      expect(result.finalAnswer).toContain('Hello')
      expect(result.goal).toBe('greet user')
    })
  })
})
