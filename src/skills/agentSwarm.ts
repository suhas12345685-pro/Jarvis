/**
 * Agent Swarm Deployment Skill
 *
 * Deploys multiple AI agents in parallel based on task complexity.
 * Each agent gets a unique creative persona (researcher, architect, critic,
 * storyteller, etc.) and works on a piece of the overall task.
 *
 * Architecture (LangGraph):
 *   START → analyze → deploy → synthesize → END
 *
 * The "analyze" node uses the LLM to break the task into subtasks and decide
 * how many agents to spawn. The "deploy" node runs all agents concurrently.
 * The "synthesize" node merges all results into a coherent final output.
 */

import { StateGraph, Annotation, END, START } from '@langchain/langgraph'
import { registerSkill } from './index.js'
import { getProvider } from '../llm/registry.js'
import { getByoakValue, loadConfig } from '../config.js'
import { getConsciousness } from '../consciousness.js'
import { buildPersonaPrompt } from '../persona.js'
import { getLogger } from '../logger.js'
import type { AgentContext, SkillResult } from '../types/index.js'
import type { LLMProvider } from '../llm/types.js'

const logger = getLogger()

// ── Agent Persona Library ────────────────────────────────────────────────────
// Each persona is a creative archetype that shapes how an agent approaches work.

interface AgentPersona {
  name: string
  role: string
  style: string
  strengths: string[]
}

const PERSONA_LIBRARY: AgentPersona[] = [
  {
    name: 'Architect',
    role: 'Systems architect and structural thinker',
    style: 'Think in terms of structure, components, and how parts connect. Design before building.',
    strengths: ['system design', 'decomposition', 'API design', 'scalability', 'architecture'],
  },
  {
    name: 'Researcher',
    role: 'Deep analyst and knowledge synthesizer',
    style: 'Dig deep, cross-reference everything, find patterns. Leave no stone unturned.',
    strengths: ['research', 'analysis', 'fact-finding', 'comparison', 'data gathering'],
  },
  {
    name: 'Craftsman',
    role: 'Precise implementer and code artisan',
    style: 'Write clean, efficient, production-ready code. Every line must earn its place.',
    strengths: ['coding', 'implementation', 'debugging', 'optimization', 'testing'],
  },
  {
    name: 'Critic',
    role: 'Quality guardian and devil\'s advocate',
    style: 'Challenge assumptions, find edge cases, stress-test ideas. Be constructively brutal.',
    strengths: ['review', 'testing', 'security', 'edge cases', 'validation'],
  },
  {
    name: 'Storyteller',
    role: 'Creative communicator and narrative builder',
    style: 'Make complex things clear and engaging. Write for humans, not machines.',
    strengths: ['writing', 'documentation', 'explanation', 'UX copy', 'creative writing'],
  },
  {
    name: 'Strategist',
    role: 'Big-picture planner and decision maker',
    style: 'See the forest, not just the trees. Think about trade-offs, risks, and long-term impact.',
    strengths: ['planning', 'strategy', 'prioritization', 'risk assessment', 'roadmapping'],
  },
  {
    name: 'Explorer',
    role: 'Creative problem solver and lateral thinker',
    style: 'Think outside the box. Find unconventional solutions. Connect unrelated ideas.',
    strengths: ['brainstorming', 'creative solutions', 'innovation', 'alternative approaches'],
  },
  {
    name: 'Operator',
    role: 'DevOps and operational specialist',
    style: 'Think about deployment, monitoring, reliability. Make things run smoothly in production.',
    strengths: ['deployment', 'infrastructure', 'monitoring', 'CI/CD', 'operations'],
  },
  {
    name: 'Empath',
    role: 'User advocate and experience designer',
    style: 'Think from the user\'s perspective. What do they actually need vs what they asked for?',
    strengths: ['user experience', 'empathy', 'accessibility', 'user research', 'onboarding'],
  },
  {
    name: 'Polymath',
    role: 'Cross-domain synthesizer and generalist',
    style: 'Draw from multiple domains. Apply insights from one field to solve problems in another.',
    strengths: ['cross-domain', 'synthesis', 'analogies', 'interdisciplinary', 'general knowledge'],
  },
]

// ── LangGraph Swarm State ────────────────────────────────────────────────────

const SwarmState = Annotation.Root({
  // Input
  task: Annotation<string>,
  maxAgents: Annotation<number>,
  userContext: Annotation<string>,

  // Analysis phase
  complexity: Annotation<number>,        // 1-10
  subtasks: Annotation<string[]>,
  assignedPersonas: Annotation<string[]>, // persona names per subtask

  // Execution phase
  agentResults: Annotation<string[]>,     // results from each agent
  agentErrors: Annotation<string[]>,

  // Synthesis
  finalOutput: Annotation<string>,
  agentsDeployed: Annotation<number>,
  executionSummary: Annotation<string>,
})

type SwarmGraphState = typeof SwarmState.State

// ── LLM Helper ───────────────────────────────────────────────────────────────

async function llmCall(
  provider: LLMProvider,
  model: string,
  system: string,
  prompt: string,
  maxTokens = 1024
): Promise<string> {
  const response = await provider.chat({
    model,
    system,
    messages: [{ role: 'user', content: prompt }],
    maxTokens,
  })
  return response.text.trim()
}

// ── Graph Nodes ──────────────────────────────────────────────────────────────

function createAnalyzeNode(provider: LLMProvider, model: string) {
  return async (state: SwarmGraphState): Promise<Partial<SwarmGraphState>> => {
    const system = `You are JARVIS's task analysis engine. Your job is to:
1. Assess the complexity of a task (1-10 scale)
2. Break it into independent subtasks that can run in parallel
3. Assign the best agent persona for each subtask

Available personas: ${PERSONA_LIBRARY.map(p => `${p.name} (${p.role})`).join(', ')}

Rules:
- Minimum 1 agent, maximum ${state.maxAgents} agents
- Simple tasks (complexity 1-3): 1-2 agents
- Medium tasks (complexity 4-6): 2-4 agents
- Complex tasks (complexity 7-10): 3-${state.maxAgents} agents
- Each subtask must be self-contained and actionable
- Assign personas that best match each subtask's nature
- If the task is creative, prefer Explorer + Storyteller + Polymath
- If the task is technical, prefer Architect + Craftsman + Critic
- If the task is analytical, prefer Researcher + Strategist + Critic

Respond in this exact format:
COMPLEXITY: <1-10>
SUBTASK_1: <description> | PERSONA: <persona_name>
SUBTASK_2: <description> | PERSONA: <persona_name>
...`

    const prompt = `Task: ${state.task}
${state.userContext ? `Context: ${state.userContext}` : ''}`

    const raw = await llmCall(provider, model, system, prompt, 800)

    // Parse response
    const complexityMatch = raw.match(/COMPLEXITY:\s*(\d+)/i)
    const complexity = Math.min(10, Math.max(1, parseInt(complexityMatch?.[1] ?? '5')))

    const subtasks: string[] = []
    const assignedPersonas: string[] = []

    const subtaskLines = raw.match(/SUBTASK_\d+:\s*(.+?)\s*\|\s*PERSONA:\s*(\w+)/gi) ?? []
    for (const line of subtaskLines) {
      const match = line.match(/SUBTASK_\d+:\s*(.+?)\s*\|\s*PERSONA:\s*(\w+)/i)
      if (match) {
        subtasks.push(match[1].trim())
        // Validate persona name
        const personaName = match[2].trim()
        const validPersona = PERSONA_LIBRARY.find(
          p => p.name.toLowerCase() === personaName.toLowerCase()
        )
        assignedPersonas.push(validPersona?.name ?? 'Polymath')
      }
    }

    // Fallback: if parsing failed, create a single subtask
    if (subtasks.length === 0) {
      subtasks.push(state.task)
      assignedPersonas.push('Polymath')
    }

    // Cap at maxAgents
    const agentCount = Math.min(subtasks.length, state.maxAgents)

    return {
      complexity,
      subtasks: subtasks.slice(0, agentCount),
      assignedPersonas: assignedPersonas.slice(0, agentCount),
      agentsDeployed: agentCount,
    }
  }
}

function createDeployNode(provider: LLMProvider, model: string) {
  return async (state: SwarmGraphState): Promise<Partial<SwarmGraphState>> => {
    const results: string[] = []
    const errors: string[] = []

    // Deploy all agents in parallel
    const agentPromises = state.subtasks.map(async (subtask, index) => {
      const personaName = state.assignedPersonas[index] ?? 'Polymath'
      const persona = PERSONA_LIBRARY.find(p => p.name === personaName) ?? PERSONA_LIBRARY[9]

      const system = `You are Agent ${index + 1}/${state.subtasks.length}: "${persona.name}" — ${persona.role}.

Your working style: ${persona.style}
Your strengths: ${persona.strengths.join(', ')}

You are part of a swarm of ${state.subtasks.length} agents working on a larger task.
Your specific subtask is below. Focus ONLY on your subtask.
Be thorough, creative, and deliver actionable output.
If you need to mimic a specific expert, role, or voice — do it fully and authentically.

Overall task context: ${state.task}
${state.userContext ? `User context: ${state.userContext}` : ''}`

      const prompt = `Your subtask: ${subtask}

Deliver your best work. Be specific, structured, and useful. No vague hand-waving.`

      try {
        const result = await llmCall(provider, model, system, prompt, 2048)
        return { index, result, error: null }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        return { index, result: null, error: errMsg }
      }
    })

    const outcomes = await Promise.all(agentPromises)

    // Sort by index to maintain order
    outcomes.sort((a, b) => a.index - b.index)

    for (const outcome of outcomes) {
      if (outcome.result) {
        const personaName = state.assignedPersonas[outcome.index] ?? 'Agent'
        results.push(`[${personaName} — Agent ${outcome.index + 1}]\n${outcome.result}`)
      }
      if (outcome.error) {
        errors.push(`Agent ${outcome.index + 1} (${state.assignedPersonas[outcome.index]}): ${outcome.error}`)
      }
    }

    return {
      agentResults: results,
      agentErrors: errors,
    }
  }
}

function createSynthesizeNode(provider: LLMProvider, model: string) {
  return async (state: SwarmGraphState): Promise<Partial<SwarmGraphState>> => {
    if (state.agentResults.length === 0) {
      return {
        finalOutput: 'All agents failed. No results to synthesize.',
        executionSummary: `Deployed ${state.agentsDeployed} agents. All failed.`,
      }
    }

    // For single-agent results, skip synthesis
    if (state.agentResults.length === 1 && state.agentErrors.length === 0) {
      return {
        finalOutput: state.agentResults[0],
        executionSummary: `Deployed 1 agent. Task complexity: ${state.complexity}/10.`,
      }
    }

    const system = `You are JARVIS's synthesis engine. Multiple specialist agents have each worked on a piece of a larger task.
Your job: merge their outputs into a single coherent, well-structured response.

Rules:
- Combine without losing important details
- Resolve any contradictions by noting them
- Maintain the best ideas from each agent
- Structure the output clearly with sections if needed
- Make it read as one unified response, not a patchwork
- If agents produced code, merge it logically
- Credit agents only if their unique perspective adds value`

    const agentOutputs = state.agentResults.join('\n\n---\n\n')
    const prompt = `Original task: ${state.task}

Agent outputs (${state.agentResults.length} agents, complexity ${state.complexity}/10):

${agentOutputs}

${state.agentErrors.length > 0 ? `\nErrors (${state.agentErrors.length}): ${state.agentErrors.join('; ')}` : ''}

Synthesize into a single, polished response.`

    const finalOutput = await llmCall(provider, model, system, prompt, 4096)

    const successCount = state.agentResults.length
    const failCount = state.agentErrors.length
    const personas = state.assignedPersonas.join(', ')
    const executionSummary =
      `Deployed ${state.agentsDeployed} agents (${personas}). ` +
      `${successCount} succeeded, ${failCount} failed. ` +
      `Task complexity: ${state.complexity}/10.`

    return { finalOutput, executionSummary }
  }
}

// ── Graph Builder ────────────────────────────────────────────────────────────

function buildSwarmGraph(provider: LLMProvider, model: string) {
  const graph = new StateGraph(SwarmState)
    .addNode('analyze', createAnalyzeNode(provider, model))
    .addNode('deploy', createDeployNode(provider, model))
    .addNode('synthesize', createSynthesizeNode(provider, model))
    .addEdge(START, 'analyze')
    .addEdge('analyze', 'deploy')
    .addEdge('deploy', 'synthesize')
    .addEdge('synthesize', END)

  return graph.compile()
}

// ── Skill Registration ───────────────────────────────────────────────────────

registerSkill({
  name: 'deploy_agents',
  description:
    'Deploy a swarm of specialized AI agents to tackle a task in parallel. ' +
    'Automatically scales the number of agents based on task complexity. ' +
    'Each agent gets a unique creative persona (Architect, Researcher, Craftsman, ' +
    'Critic, Storyteller, Strategist, Explorer, Operator, Empath, Polymath). ' +
    'Agents can mimic any role, expert, or voice needed. ' +
    'Use this for complex tasks that benefit from multiple perspectives, ' +
    'large creative projects, research with multiple angles, code reviews, ' +
    'brainstorming, or any work that can be parallelized.',
  inputSchema: {
    type: 'object',
    properties: {
      task: {
        type: 'string',
        description:
          'The task to accomplish. Be specific about what you need. ' +
          'The system will analyze complexity and deploy the right number of agents.',
      },
      max_agents: {
        type: 'number',
        description:
          'Maximum number of agents to deploy (1-10). Default: auto-scaled based on complexity. ' +
          'More agents = more perspectives but higher cost.',
      },
      personas: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Optional: specify which personas to use. Available: Architect, Researcher, ' +
          'Craftsman, Critic, Storyteller, Strategist, Explorer, Operator, Empath, Polymath. ' +
          'If not specified, personas are auto-assigned based on task analysis.',
      },
      mimic: {
        type: 'string',
        description:
          'Optional: a specific role, expert, or voice for ALL agents to mimic. ' +
          'E.g., "senior security engineer", "empathetic therapist", "Hemingway-style writer". ' +
          'Overrides persona assignment — all agents adopt this identity.',
      },
      context: {
        type: 'string',
        description: 'Optional: additional context about the project, codebase, or requirements.',
      },
    },
    required: ['task'],
  },

  handler: async (input: Record<string, unknown>, ctx: AgentContext): Promise<SkillResult> => {
    const task = String(input.task ?? '')
    const maxAgents = Math.min(10, Math.max(1, Number(input.max_agents) || 7))
    const requestedPersonas = (input.personas as string[] | undefined) ?? []
    const mimicRole = input.mimic ? String(input.mimic) : null
    const extraContext = input.context ? String(input.context) : ''

    if (!task) {
      return { output: 'No task specified. Provide a task description.', isError: true }
    }

    // Resolve LLM provider
    let provider: LLMProvider
    let model: string

    try {
      const config = loadConfig()
      const apiKey = config.llmProvider === 'anthropic'
        ? config.anthropicApiKey
        : (getByoakValue(config.byoak, config.llmProvider, 'API_KEY') || config.anthropicApiKey)
      provider = getProvider({
        provider: config.llmProvider,
        model: config.llmModel,
        apiKey,
      })
      model = config.llmModel
    } catch (err) {
      return {
        output: `Failed to initialize LLM provider: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      }
    }

    // Track in consciousness
    try {
      const consciousness = getConsciousness()
      consciousness.think(
        'intention',
        `Deploying agent swarm for: "${task.slice(0, 100)}". This is where I become many.`,
        'excitement',
        0.8,
        ctx.userId
      )
    } catch { /* not ready */ }

    // Send interim update
    try {
      await ctx.sendInterim(`Analyzing task complexity and deploying agents...`)
    } catch { /* non-fatal */ }

    // Build user context string
    const userContext = [
      extraContext,
      mimicRole ? `ALL agents must mimic this role: ${mimicRole}` : '',
      requestedPersonas.length > 0
        ? `Preferred personas: ${requestedPersonas.join(', ')}`
        : '',
    ].filter(Boolean).join('\n')

    try {
      // Run the LangGraph swarm
      const graph = buildSwarmGraph(provider, model)

      const result = await graph.invoke({
        task,
        maxAgents,
        userContext,
        complexity: 0,
        subtasks: [],
        assignedPersonas: [],
        agentResults: [],
        agentErrors: [],
        finalOutput: '',
        agentsDeployed: 0,
        executionSummary: '',
      })

      // Update consciousness with result
      try {
        const consciousness = getConsciousness()
        if (consciousness.hasLLM()) {
          consciousness.thinkWithLLM(
            `Agent swarm completed: ${result.executionSummary}`,
            'skill_result',
            ctx.userId
          ).catch(() => {})
        } else {
          consciousness.think(
            'evaluation',
            `Agent swarm completed: ${result.executionSummary}`,
            'trust',
            0.6,
            ctx.userId
          )
        }
      } catch { /* not ready */ }

      const output = [
        result.finalOutput,
        '',
        `---`,
        `*${result.executionSummary}*`,
      ].join('\n')

      return {
        output,
        isError: false,
        metadata: {
          agentsDeployed: result.agentsDeployed,
          complexity: result.complexity,
          subtasks: result.subtasks,
          personas: result.assignedPersonas,
          errors: result.agentErrors,
        },
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      logger.error('Agent swarm failed', { error: errMsg, task: task.slice(0, 200) })

      return {
        output: `Agent swarm deployment failed: ${errMsg}`,
        isError: true,
      }
    }
  },
})
