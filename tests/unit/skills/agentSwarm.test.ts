import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock all dependencies
vi.mock('../../../src/logger.js', () => ({
  getLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}))

vi.mock('../../../src/llm/registry.js', () => ({
  getProvider: vi.fn().mockReturnValue({ chat: vi.fn() }),
}))

vi.mock('../../../src/config.js', () => ({
  loadConfig: vi.fn().mockReturnValue({
    llmProvider: 'anthropic',
    llmModel: 'claude-sonnet-4-6',
    anthropicApiKey: 'test-key',
    byoak: [],
  }),
  getByoakValue: vi.fn(() => null),
}))

vi.mock('../../../src/consciousness.js', () => ({
  getConsciousness: vi.fn().mockReturnValue({
    think: vi.fn(),
    thinkWithLLM: vi.fn().mockResolvedValue(undefined),
    hasLLM: vi.fn().mockReturnValue(false),
  }),
}))

vi.mock('../../../src/persona.js', () => ({
  buildPersonaPrompt: vi.fn().mockReturnValue('You are JARVIS'),
}))

// Mock LangGraph
const mockInvoke = vi.fn()
vi.mock('@langchain/langgraph', () => ({
  StateGraph: vi.fn().mockImplementation(() => ({
    addNode: vi.fn().mockReturnThis(),
    addEdge: vi.fn().mockReturnThis(),
    addConditionalEdges: vi.fn().mockReturnThis(),
    compile: vi.fn().mockReturnValue({ invoke: mockInvoke }),
  })),
  Annotation: {
    Root: vi.fn().mockReturnValue({ State: {} as any }),
  },
  END: 'END',
  START: 'START',
}))

import { getSkill } from '../../../src/skills/index.js'
import '../../../src/skills/agentSwarm.js'

const ctx: any = { userId: 'u1', channelType: 'test', threadId: 't1', memories: [], sendInterim: vi.fn() }

describe('agentSwarm skill', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInvoke.mockResolvedValue({
      finalOutput: 'Comprehensive analysis from multiple agents.',
      executionSummary: 'Deployed 3 agents (Architect, Researcher, Critic). 3 succeeded, 0 failed. Task complexity: 7/10.',
      agentsDeployed: 3,
      complexity: 7,
      subtasks: ['Design architecture', 'Research options', 'Review plan'],
      assignedPersonas: ['Architect', 'Researcher', 'Critic'],
      agentErrors: [],
    })
  })

  describe('deploy_agents', () => {
    const skill = getSkill('deploy_agents')!

    it('returns error for empty task', async () => {
      const res = await skill.handler({ task: '' }, ctx)
      expect(res.isError).toBe(true)
      expect(res.output).toContain('No task specified')
    })

    it('deploys agent swarm successfully', async () => {
      const res = await skill.handler({ task: 'Design a microservices architecture' }, ctx)
      expect(res.isError).toBe(false)
      expect(res.output).toContain('Comprehensive analysis')
      expect(res.output).toContain('Deployed 3 agents')
      expect(res.metadata?.agentsDeployed).toBe(3)
      expect(res.metadata?.complexity).toBe(7)
    })

    it('caps max_agents at 10', async () => {
      await skill.handler({ task: 'Big project', max_agents: 20 }, ctx)
      expect(mockInvoke).toHaveBeenCalledWith(expect.objectContaining({
        maxAgents: 10,
      }))
    })

    it('passes context and mimic role', async () => {
      await skill.handler({
        task: 'Write a blog post',
        context: 'Tech blog about AI',
        mimic: 'Paul Graham',
      }, ctx)
      expect(mockInvoke).toHaveBeenCalledWith(expect.objectContaining({
        userContext: expect.stringContaining('Paul Graham'),
      }))
    })

    it('handles graph errors', async () => {
      mockInvoke.mockRejectedValue(new Error('Graph execution failed'))
      const res = await skill.handler({ task: 'test' }, ctx)
      expect(res.isError).toBe(true)
      expect(res.output).toContain('failed')
    })
  })
})
