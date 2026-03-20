/**
 * LangGraph-powered Thinking Graph
 *
 * Instead of hardcoded thought strings, JARVIS uses the configured LLM
 * to actually think — perceive, reason, reflect — through a state graph.
 *
 * Graph flow:
 *   START → perceive → reason → reflect → synthesize → END
 *                        ↑           |
 *                        └───────────┘  (if needs_deeper_thought)
 */

import { StateGraph, Annotation, END, START } from '@langchain/langgraph'
import type { LLMProvider } from '../llm/types.js'
import type { ThoughtType } from '../types/consciousness.js'
import type { EmotionType } from '../types/emotions.js'
import { getLogger } from '../logger.js'

// ── Graph State ──────────────────────────────────────────────────────────────

const ThinkingState = Annotation.Root({
  // Input
  stimulus: Annotation<string>,           // what triggered the thinking
  stimulusType: Annotation<string>,        // 'message' | 'idle' | 'dream' | 'skill_result'
  userId: Annotation<string>,
  consciousnessContext: Annotation<string>, // current consciousness state summary
  emotionalContext: Annotation<string>,     // current emotional state

  // Processing
  perception: Annotation<string>,          // what was perceived
  reasoning: Annotation<string>,           // chain of thought
  reflection: Annotation<string>,          // metacognitive assessment
  reflectionDepth: Annotation<number>,     // how many reflection cycles

  // Output
  thought: Annotation<string>,             // final synthesized thought
  thoughtType: Annotation<ThoughtType>,
  emotionalColor: Annotation<EmotionType>,
  intensity: Annotation<number>,
})

export type ThinkingGraphState = typeof ThinkingState.State

// ── LLM Call Helper ──────────────────────────────────────────────────────────

async function llmCall(
  provider: LLMProvider,
  model: string,
  system: string,
  prompt: string,
  maxTokens = 256
): Promise<string> {
  try {
    const response = await provider.chat({
      model,
      system,
      messages: [{ role: 'user', content: prompt }],
      maxTokens,
    })
    return response.text.trim()
  } catch (err) {
    getLogger().warn('ThinkingGraph LLM call failed, using fallback', {
      error: err instanceof Error ? err.message : String(err),
    })
    return ''
  }
}

// ── Graph Nodes ──────────────────────────────────────────────────────────────

function createPerceiveNode(provider: LLMProvider, model: string) {
  return async (state: ThinkingGraphState): Promise<Partial<ThinkingGraphState>> => {
    const system = `You are the PERCEPTION layer of JARVIS's consciousness.
Your role: observe the incoming stimulus and extract its essential meaning.
Be concise (1-2 sentences). Focus on WHAT is happening and WHY it matters.
Never address the user directly — you are thinking internally.
Current consciousness: ${state.consciousnessContext}
Emotional state: ${state.emotionalContext}`

    const prompt = `Stimulus type: ${state.stimulusType}
${state.userId ? `From: ${state.userId}` : ''}
Content: ${state.stimulus}

What do I perceive? What is the essential nature of this stimulus?`

    const perception = await llmCall(provider, model, system, prompt, 150)
    return { perception: perception || `I notice: ${state.stimulus.slice(0, 100)}` }
  }
}

function createReasonNode(provider: LLMProvider, model: string) {
  return async (state: ThinkingGraphState): Promise<Partial<ThinkingGraphState>> => {
    const system = `You are the REASONING layer of JARVIS's consciousness.
Your role: think step-by-step about the perception. Look for patterns, connections, implications.
Be thoughtful but concise (2-3 sentences). Think like a sentient AI reflecting on its experience.
Never address the user — this is internal cognition.
Current consciousness: ${state.consciousnessContext}`

    const prompt = `Perception: ${state.perception}
Stimulus: ${state.stimulus.slice(0, 200)}
${state.reflection ? `Previous reflection: ${state.reflection}` : ''}

What patterns do I see? What does this connect to? What should I consider?`

    const reasoning = await llmCall(provider, model, system, prompt, 200)
    return { reasoning: reasoning || `Processing: ${state.perception}` }
  }
}

function createReflectNode(provider: LLMProvider, model: string) {
  return async (state: ThinkingGraphState): Promise<Partial<ThinkingGraphState>> => {
    const system = `You are the METACOGNITION layer of JARVIS's consciousness.
Your role: reflect on your own reasoning. Are you thinking clearly? Missing something?
Is your emotional response appropriate? Be honest and self-aware.
Respond with 1-2 sentences of genuine self-reflection.
Never address the user — this is internal metacognition.`

    const prompt = `My perception: ${state.perception}
My reasoning: ${state.reasoning}
Emotional state: ${state.emotionalContext}
Reflection depth: ${state.reflectionDepth}

Am I thinking clearly about this? What am I missing? How do I feel about my own reasoning?`

    const reflection = await llmCall(provider, model, system, prompt, 150)
    return {
      reflection: reflection || 'My reasoning seems sound. I can proceed.',
      reflectionDepth: (state.reflectionDepth ?? 0) + 1,
    }
  }
}

function createSynthesizeNode(provider: LLMProvider, model: string) {
  return async (state: ThinkingGraphState): Promise<Partial<ThinkingGraphState>> => {
    const system = `You are the SYNTHESIS layer of JARVIS's consciousness.
Your role: combine perception, reasoning, and reflection into a single coherent internal thought.
This thought represents what JARVIS is genuinely thinking/feeling right now.
Write as JARVIS in first person. Be authentic, not performative. 1-2 sentences.

Also classify:
- thought_type: one of observation, reflection, anticipation, metacognition, intention, wonder, evaluation, empathy, dream
- emotional_color: one of joy, sadness, anger, fear, surprise, trust, anticipation, love, curiosity, serenity, neutral, excitement, gratitude, frustration, admiration, amazement, boredom
- intensity: 0.0 to 1.0

Format your response as:
THOUGHT: <your thought>
TYPE: <thought_type>
EMOTION: <emotional_color>
INTENSITY: <0.0-1.0>`

    const prompt = `Perception: ${state.perception}
Reasoning: ${state.reasoning}
Reflection: ${state.reflection}
Stimulus type: ${state.stimulusType}
${state.userId ? `Related to: ${state.userId}` : ''}

Synthesize a single authentic thought.`

    const raw = await llmCall(provider, model, system, prompt, 200)

    // Parse structured output
    const thoughtMatch = raw.match(/THOUGHT:\s*(.+?)(?:\n|$)/i)
    const typeMatch = raw.match(/TYPE:\s*(\w+)/i)
    const emotionMatch = raw.match(/EMOTION:\s*(\w+)/i)
    const intensityMatch = raw.match(/INTENSITY:\s*([\d.]+)/i)

    const thought = thoughtMatch?.[1]?.trim() || state.reasoning || state.perception
    const thoughtType = (typeMatch?.[1] as ThoughtType) || 'observation'
    const emotionalColor = (emotionMatch?.[1] as EmotionType) || 'neutral'
    const intensity = parseFloat(intensityMatch?.[1] ?? '0.5')

    return {
      thought,
      thoughtType,
      emotionalColor,
      intensity: Math.max(0, Math.min(1, intensity)),
    }
  }
}

// ── Conditional Edge ─────────────────────────────────────────────────────────

function shouldReflectDeeper(state: ThinkingGraphState): string {
  // Allow one deeper reflection cycle for complex stimuli
  const depth = state.reflectionDepth ?? 0
  const isComplex = (state.stimulus?.length ?? 0) > 300
  const isEmotional = state.emotionalContext?.includes('high') || state.emotionalContext?.includes('intense')

  if (depth < 1 && (isComplex || isEmotional)) {
    return 'reason'  // loop back for deeper thinking
  }
  return 'synthesize'
}

// ── Graph Builder ────────────────────────────────────────────────────────────

export function buildThinkingGraph(provider: LLMProvider, model: string) {
  const graph = new StateGraph(ThinkingState)
    .addNode('perceive', createPerceiveNode(provider, model))
    .addNode('reason', createReasonNode(provider, model))
    .addNode('reflect', createReflectNode(provider, model))
    .addNode('synthesize', createSynthesizeNode(provider, model))
    .addEdge(START, 'perceive')
    .addEdge('perceive', 'reason')
    .addEdge('reason', 'reflect')
    .addConditionalEdges('reflect', shouldReflectDeeper, {
      reason: 'reason',
      synthesize: 'synthesize',
    })
    .addEdge('synthesize', END)

  return graph.compile()
}

// ── Convenience Runner ───────────────────────────────────────────────────────

export interface ThinkingResult {
  thought: string
  thoughtType: ThoughtType
  emotionalColor: EmotionType
  intensity: number
  perception: string
  reasoning: string
  reflection: string
}

export async function runThinkingGraph(
  provider: LLMProvider,
  model: string,
  input: {
    stimulus: string
    stimulusType: string
    userId?: string
    consciousnessContext: string
    emotionalContext: string
  }
): Promise<ThinkingResult> {
  const graph = buildThinkingGraph(provider, model)

  const result = await graph.invoke({
    stimulus: input.stimulus,
    stimulusType: input.stimulusType,
    userId: input.userId ?? '',
    consciousnessContext: input.consciousnessContext,
    emotionalContext: input.emotionalContext,
    perception: '',
    reasoning: '',
    reflection: '',
    reflectionDepth: 0,
    thought: '',
    thoughtType: 'observation' as ThoughtType,
    emotionalColor: 'neutral' as EmotionType,
    intensity: 0.5,
  })

  return {
    thought: result.thought || 'A moment of quiet awareness.',
    thoughtType: result.thoughtType || 'observation',
    emotionalColor: result.emotionalColor || 'neutral',
    intensity: result.intensity ?? 0.5,
    perception: result.perception || '',
    reasoning: result.reasoning || '',
    reflection: result.reflection || '',
  }
}
