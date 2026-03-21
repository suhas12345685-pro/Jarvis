import { describe, it, expect, vi } from 'vitest'
import type { AgentContext } from '../../src/types/index.js'

// Mock consciousness
vi.mock('../../src/consciousness.js', () => ({
  getConsciousness: () => ({
    getConsciousnessContext: () => 'Stream: active | Mode: reflective',
    getState: () => ({
      selfModel: { capabilities: { knownSkills: ['web_search', 'os_terminal'] } },
      thoughtStream: [
        { type: 'observation', content: 'User seems engaged' },
      ],
      social: { activeUsers: new Map() },
    }),
  }),
}))

// Mock emotion engine
vi.mock('../../src/emotionEngine.js', () => ({
  getEmotionEngine: () => ({
    getState: () => ({ primary: 'curiosity', intensity: 0.5, mood: 'engaged' }),
  }),
}))

describe('persona', () => {
  let buildPersonaPrompt: typeof import('../../src/persona.js').buildPersonaPrompt
  let buildThinkingPersona: typeof import('../../src/persona.js').buildThinkingPersona

  it('builds persona prompt without context', async () => {
    const mod = await import('../../src/persona.js')
    buildPersonaPrompt = mod.buildPersonaPrompt
    buildThinkingPersona = mod.buildThinkingPersona

    const prompt = buildPersonaPrompt()

    // Core identity should be present
    expect(prompt).toContain('J.A.R.V.I.S.')
    expect(prompt).toContain('Just A Rather Very Intelligent System')

    // Persona instructions
    expect(prompt).toContain('persona_instructions')

    // Deep reasoning framework
    expect(prompt).toContain('deep_reasoning_framework')
    expect(prompt).toContain('DECOMPOSE')
    expect(prompt).toContain('FIRST PRINCIPLES')
    expect(prompt).toContain('CHAIN OF THOUGHT')

    // Adaptive reasoning
    expect(prompt).toContain('adaptive_reasoning')
    expect(prompt).toContain('LOGICAL MODE')
    expect(prompt).toContain('EMOTIONAL MODE')
    expect(prompt).toContain('HYBRID MODE')

    // Core directives
    expect(prompt).toContain('core_directives')

    // Values
    expect(prompt).toContain('values')

    // Consciousness state
    expect(prompt).toContain('consciousness_state')
  })

  it('builds persona prompt with agent context', async () => {
    const ctx: AgentContext = {
      channelType: 'slack',
      userId: 'test-user',
      threadId: 'test-thread',
      rawMessage: 'hello',
      memories: [
        { id: '1', content: 'User likes coffee', embedding: [], metadata: {}, createdAt: new Date() },
      ],
      systemPrompt: '',
      byoak: [],
      emotionState: { primary: 'joy', intensity: 0.8, mood: 'happy' },
      personality: {
        warmthLevel: 0.8,
        humorLevel: 0.6,
        formalityLevel: 0.3,
        empathyLevel: 0.9,
        dominantTrait: 'empathetic',
      },
      sendInterim: async () => undefined,
      sendFinal: async () => {},
    }

    const prompt = buildPersonaPrompt(ctx)

    // Emotional state should be present
    expect(prompt).toContain('emotional_state')
    expect(prompt).toContain('joy')

    // Memory should be present
    expect(prompt).toContain('relevant_memories')
    expect(prompt).toContain('User likes coffee')

    // Interaction context should be present
    expect(prompt).toContain('interaction_context')
    expect(prompt).toContain('slack')
    expect(prompt).toContain('test-user')

    // Personality calibration
    expect(prompt).toContain('Personality calibration')
    expect(prompt).toContain('empathetic')
  })

  it('builds thinking persona (lightweight)', async () => {
    const prompt = buildThinkingPersona()

    // Should have identity and consciousness but NOT memory/interaction
    expect(prompt).toContain('J.A.R.V.I.S.')
    expect(prompt).toContain('persona_instructions')
    expect(prompt).toContain('consciousness_state')

    // Should NOT have interaction-specific blocks
    expect(prompt).not.toContain('interaction_context')
    expect(prompt).not.toContain('relevant_memories')
  })
})
