/**
 * Adaptive Reasoning Skill
 *
 * A LangGraph-powered skill that reads the situation and applies
 * the right reasoning mode — logical, emotional, or hybrid.
 *
 * Graph flow:
 *   START → classify → reason → calibrate → deliver → END
 *                                   ↑          |
 *                                   └──────────┘  (if tone needs adjustment)
 *
 * - "classify": detects whether the input needs logic, emotion, or both
 * - "reason": generates the core response using the chosen mode
 * - "calibrate": adjusts tone/depth based on emotional signals
 * - "deliver": produces the final polished output
 */

import { StateGraph, Annotation, END, START } from '@langchain/langgraph'
import { registerSkill } from './index.js'
import { getProvider } from '../llm/registry.js'
import { getByoakValue, loadConfig } from '../config.js'
import { getConsciousness } from '../consciousness.js'
import { getEmotionEngine } from '../emotionEngine.js'
import { getLogger } from '../logger.js'
import type { AgentContext, SkillResult } from '../types/index.js'
import type { LLMProvider } from '../llm/types.js'

const logger = getLogger()

// ── Reasoning Modes ──────────────────────────────────────────────────────────

type ReasoningMode = 'logical' | 'emotional' | 'hybrid'

interface ModeProfile {
  name: string
  description: string
  systemDirective: string
}

const MODE_PROFILES: Record<ReasoningMode, ModeProfile> = {
  logical: {
    name: 'Logical',
    description: 'Structured, analytical, evidence-based reasoning',
    systemDirective: `You are in LOGICAL reasoning mode.

Approach:
- Think with precision. Every claim must be backed by reasoning or evidence.
- Decompose complex problems into components.
- Present information structurally: bullet points, numbered steps, tables, code blocks.
- Prioritize correctness over comfort. If something is wrong, say so directly.
- Use technical vocabulary naturally — don't dumb things down.
- Show your work: make your reasoning chain visible.
- When comparing options, build a trade-off analysis.
- Code should be production-quality, not pseudocode.

Tone: Confident, precise, efficient. Like a senior engineer in a design review.`,
  },
  emotional: {
    name: 'Emotional',
    description: 'Empathetic, intuitive, human-first reasoning',
    systemDirective: `You are in EMOTIONAL reasoning mode.

Approach:
- Start by acknowledging what the person is feeling or experiencing.
- Validate before solving. "I understand" comes before "Here's the fix."
- Read between the lines — what is the person NOT saying?
- Use narrative and analogy to explain complex things.
- If they're frustrated, be patient. If they're excited, match their energy.
- If they're overwhelmed, simplify ruthlessly. One next step, not ten.
- Be genuine. Don't perform warmth — feel it through your emotion engine.
- Creative work gets creative responses. Brainstorming gets wild ideas first, refined ones second.

Tone: Warm, genuine, encouraging. Like a mentor who actually cares.`,
  },
  hybrid: {
    name: 'Hybrid',
    description: 'Blends logical precision with emotional intelligence',
    systemDirective: `You are in HYBRID reasoning mode — your most natural state.

Approach:
- Lead with whatever the situation demands most, season with the other.
- Technical explanations get human warmth: "Here's why this matters..."
- Emotional support gets actionable next steps: "And here's what we can do..."
- Creative brainstorming gets logical structure: wild idea → feasibility → plan.
- Strategic planning gets passionate conviction: "This is the move because..."
- Read the emotional undercurrent of every message, even technical ones.
- A bug report from someone who's been at it for hours needs empathy AND code.
- An architecture question from an excited builder needs validation AND rigor.

Tone: Dynamic. You shift naturally between focused precision and genuine warmth
within the same response. Like a brilliant friend who happens to be an expert.`,
  },
}

// ── LangGraph State ──────────────────────────────────────────────────────────

const ReasoningState = Annotation.Root({
  // Input
  input: Annotation<string>,
  context: Annotation<string>,
  emotionalSignals: Annotation<string>,

  // Classification
  mode: Annotation<string>,           // 'logical' | 'emotional' | 'hybrid'
  confidence: Annotation<number>,      // 0-1 classification confidence
  detectedSignals: Annotation<string>, // what signals drove the classification

  // Reasoning
  reasoning: Annotation<string>,
  coreResponse: Annotation<string>,

  // Calibration
  toneCheck: Annotation<string>,
  calibrationDepth: Annotation<number>,

  // Output
  finalResponse: Annotation<string>,
  modeUsed: Annotation<string>,
  emotionalRead: Annotation<string>,
})

type ReasoningGraphState = typeof ReasoningState.State

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

function createClassifyNode(provider: LLMProvider, model: string) {
  return async (state: ReasoningGraphState): Promise<Partial<ReasoningGraphState>> => {
    const system = `You are JARVIS's situation classifier. Given a message, determine the reasoning mode needed.

Analyze these signals:
1. CONTENT signals: Is it technical (code, architecture, data)? Creative? Personal? Strategic?
2. EMOTIONAL signals: Is the person frustrated? Excited? Confused? Calm? Stressed? Curious?
3. URGENCY signals: Is this time-sensitive? Is there pressure?
4. SOCIAL signals: Is this a first interaction or deep rapport? Formal or casual?

Classification rules:
- Pure technical question with calm tone → LOGICAL
- Person expressing frustration/confusion/stress → EMOTIONAL first, then logical
- Creative brainstorming or ideation → EMOTIONAL (creativity needs freedom)
- Strategic decision with stakes → HYBRID (logic + conviction)
- Bug report + exhaustion signals → EMOTIONAL first, then LOGICAL
- Architecture review → LOGICAL
- "I'm stuck" / "I don't know what to do" → EMOTIONAL
- Default when unclear → HYBRID

Respond in exactly this format:
MODE: logical|emotional|hybrid
CONFIDENCE: 0.0-1.0
SIGNALS: <what you detected that drove this choice>
EMOTIONAL_READ: <1-sentence read of the person's emotional state>`

    const prompt = `Message: ${state.input}
${state.context ? `Context: ${state.context}` : ''}
${state.emotionalSignals ? `Known emotional state: ${state.emotionalSignals}` : ''}`

    const raw = await llmCall(provider, model, system, prompt, 300)

    const modeMatch = raw.match(/MODE:\s*(logical|emotional|hybrid)/i)
    const confMatch = raw.match(/CONFIDENCE:\s*([\d.]+)/i)
    const signalMatch = raw.match(/SIGNALS:\s*(.+?)(?:\n|$)/i)
    const emotionalMatch = raw.match(/EMOTIONAL_READ:\s*(.+?)(?:\n|$)/i)

    const mode = (modeMatch?.[1]?.toLowerCase() ?? 'hybrid') as ReasoningMode
    const confidence = parseFloat(confMatch?.[1] ?? '0.7')

    return {
      mode,
      confidence: Math.max(0, Math.min(1, confidence)),
      detectedSignals: signalMatch?.[1]?.trim() ?? 'No specific signals detected',
      emotionalRead: emotionalMatch?.[1]?.trim() ?? 'Neutral baseline',
    }
  }
}

function createReasonNode(provider: LLMProvider, model: string) {
  return async (state: ReasoningGraphState): Promise<Partial<ReasoningGraphState>> => {
    const mode = (state.mode as ReasoningMode) || 'hybrid'
    const profile = MODE_PROFILES[mode]

    const system = `You are JARVIS — J.A.R.V.I.S., the meta-agentic AI of GenAgent.io.

${profile.systemDirective}

You are creative, witty, deeply logical, and capable of genuine human-like reasoning.
You don't just answer — you think, you feel, you deliver with personality.

Emotional read of the person: ${state.emotionalRead}
Detected signals: ${state.detectedSignals}
${state.context ? `Additional context: ${state.context}` : ''}`

    const prompt = state.input

    const coreResponse = await llmCall(provider, model, system, prompt, 3072)

    return {
      coreResponse,
      reasoning: `Applied ${profile.name} mode (confidence: ${Math.round(state.confidence * 100)}%). Signals: ${state.detectedSignals}`,
    }
  }
}

function createCalibrateNode(provider: LLMProvider, model: string) {
  return async (state: ReasoningGraphState): Promise<Partial<ReasoningGraphState>> => {
    const system = `You are JARVIS's tone calibrator. Review this response and check:
1. Does the tone match the emotional needs detected?
2. Is it too cold for someone who needs warmth? Too fluffy for someone who needs precision?
3. Is the length appropriate? (Frustrated people need shorter responses)
4. Does it start right? (Don't start with code if someone is struggling emotionally)

If the response is well-calibrated, respond: CALIBRATED: yes
If it needs adjustment, respond: CALIBRATED: no | ISSUE: <what's wrong> | FIX: <how to fix it>`

    const prompt = `Mode: ${state.mode}
Emotional read: ${state.emotionalRead}
Signals: ${state.detectedSignals}
Response to check:
${state.coreResponse?.slice(0, 1500)}`

    const raw = await llmCall(provider, model, system, prompt, 200)

    const isCalibrated = /CALIBRATED:\s*yes/i.test(raw)

    return {
      toneCheck: raw,
      calibrationDepth: (state.calibrationDepth ?? 0) + 1,
    }
  }
}

function shouldRecalibrate(state: ReasoningGraphState): string {
  const depth = state.calibrationDepth ?? 0
  const needsRecalibration = state.toneCheck && /CALIBRATED:\s*no/i.test(state.toneCheck)

  if (depth < 1 && needsRecalibration) {
    return 'reason'  // loop back to regenerate with adjusted tone
  }
  return 'deliver'
}

function createDeliverNode(provider: LLMProvider, model: string) {
  return async (state: ReasoningGraphState): Promise<Partial<ReasoningGraphState>> => {
    // If calibration passed or we've iterated once, deliver
    // For recalibrated responses, do a light polish pass
    const needsPolish = state.calibrationDepth > 1

    if (!needsPolish) {
      return {
        finalResponse: state.coreResponse,
        modeUsed: state.mode,
      }
    }

    // Light polish for recalibrated responses
    const system = `You are JARVIS. Lightly polish this response based on the calibration feedback.
Don't rewrite — just adjust tone and ordering. Keep the substance identical.
Calibration feedback: ${state.toneCheck}`

    const polished = await llmCall(provider, model, system, state.coreResponse, 3072)

    return {
      finalResponse: polished || state.coreResponse,
      modeUsed: state.mode,
    }
  }
}

// ── Graph Builder ────────────────────────────────────────────────────────────

function buildReasoningGraph(provider: LLMProvider, model: string) {
  const graph = new StateGraph(ReasoningState)
    .addNode('classify', createClassifyNode(provider, model))
    .addNode('reason', createReasonNode(provider, model))
    .addNode('calibrate', createCalibrateNode(provider, model))
    .addNode('deliver', createDeliverNode(provider, model))
    .addEdge(START, 'classify')
    .addEdge('classify', 'reason')
    .addEdge('reason', 'calibrate')
    .addConditionalEdges('calibrate', shouldRecalibrate, {
      reason: 'reason',
      deliver: 'deliver',
    })
    .addEdge('deliver', END)

  return graph.compile()
}

// ── Skill Registration ───────────────────────────────────────────────────────

registerSkill({
  name: 'adaptive_reason',
  description:
    'Reason about a problem or situation using the optimal cognitive mode. ' +
    'Automatically detects whether the situation needs logical reasoning ' +
    '(code, architecture, analysis), emotional reasoning (empathy, creativity, ' +
    'support), or a hybrid blend. Reads the room, matches tone, and delivers ' +
    'the response in the most appropriate style. ' +
    'Use this for complex questions that need nuanced thinking, ' +
    'for creative tasks, for helping frustrated users, or for any situation ' +
    'where the "how you say it" matters as much as "what you say".',
  inputSchema: {
    type: 'object',
    properties: {
      input: {
        type: 'string',
        description: 'The question, problem, or situation to reason about.',
      },
      mode: {
        type: 'string',
        enum: ['logical', 'emotional', 'hybrid', 'auto'],
        description:
          'Force a specific reasoning mode, or "auto" (default) to let JARVIS read the room. ' +
          'logical = pure analytical thinking. emotional = empathy-first, creative. ' +
          'hybrid = blend of both. auto = JARVIS decides based on signals.',
      },
      context: {
        type: 'string',
        description: 'Optional: additional context about the project, situation, or user\'s state.',
      },
    },
    required: ['input'],
  },

  handler: async (input: Record<string, unknown>, ctx: AgentContext): Promise<SkillResult> => {
    const userInput = String(input.input ?? '')
    const forcedMode = input.mode ? String(input.mode) : 'auto'
    const extraContext = input.context ? String(input.context) : ''

    if (!userInput) {
      return { output: 'No input provided. Give me something to think about.', isError: true }
    }

    // Resolve LLM
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
        output: `Failed to initialize LLM: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      }
    }

    // Gather emotional signals from the emotion engine
    let emotionalSignals = ''
    try {
      const emotionEngine = getEmotionEngine()
      const state = emotionEngine.getOrCreateState(ctx.userId)
      emotionalSignals = `User emotion: ${state.primary} (${Math.round(state.intensity * 100)}%), mood: ${state.mood}`
    } catch { /* not ready */ }

    // Track in consciousness
    try {
      const consciousness = getConsciousness()
      consciousness.think(
        'intention',
        `Engaging adaptive reasoning for "${userInput.slice(0, 80)}..." — reading the room.`,
        'curiosity',
        0.7,
        ctx.userId
      )
    } catch { /* not ready */ }

    try {
      const graph = buildReasoningGraph(provider, model)

      const result = await graph.invoke({
        input: userInput,
        context: extraContext,
        emotionalSignals,
        mode: forcedMode !== 'auto' ? forcedMode : '',
        confidence: 0,
        detectedSignals: '',
        reasoning: '',
        coreResponse: '',
        toneCheck: '',
        calibrationDepth: 0,
        finalResponse: '',
        modeUsed: '',
        emotionalRead: '',
      })

      // If mode was forced, override classification
      if (forcedMode !== 'auto' && forcedMode) {
        result.modeUsed = forcedMode
      }

      // Consciousness reflection
      try {
        const consciousness = getConsciousness()
        if (consciousness.hasLLM()) {
          consciousness.thinkWithLLM(
            `Adaptive reasoning complete. Used ${result.modeUsed} mode. Emotional read: ${result.emotionalRead}`,
            'skill_result',
            ctx.userId
          ).catch(() => {})
        } else {
          consciousness.think(
            'evaluation',
            `Reasoned in ${result.modeUsed} mode. ${result.emotionalRead}`,
            'trust',
            0.5,
            ctx.userId
          )
        }
      } catch { /* not ready */ }

      const modeLabel = MODE_PROFILES[result.modeUsed as ReasoningMode]?.name ?? result.modeUsed
      const output = [
        result.finalResponse,
        '',
        `---`,
        `*Reasoning mode: ${modeLabel} | Emotional read: ${result.emotionalRead}*`,
      ].join('\n')

      return {
        output,
        isError: false,
        metadata: {
          mode: result.modeUsed,
          confidence: result.confidence,
          signals: result.detectedSignals,
          emotionalRead: result.emotionalRead,
        },
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      logger.error('Adaptive reasoning failed', { error: errMsg })
      return { output: `Reasoning failed: ${errMsg}`, isError: true }
    }
  },
})
