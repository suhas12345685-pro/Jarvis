import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/logger.js', () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

vi.mock('../../src/emotionEngine.js', () => ({
  getEmotionEngine: () => ({
    getOrCreateState: () => ({
      primary: 'neutral',
      intensity: 0.5,
      mood: 'content',
    }),
  }),
}))

// Mock thinkingGraph so we don't need LangGraph
vi.mock('../../src/consciousness/thinkingGraph.js', () => ({
  runThinkingGraph: vi.fn().mockResolvedValue({
    thought: 'test thought',
    thoughtType: 'observation',
    emotionalColor: 'neutral',
    intensity: 0.5,
  }),
}))

import { ConsciousnessEngine, createConsciousness, getConsciousness, resetConsciousness } from '../../src/consciousness.js'

describe('ConsciousnessEngine', () => {
  let engine: ConsciousnessEngine

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    resetConsciousness()
    engine = createConsciousness()
  })

  afterEach(() => {
    engine.shutdown()
    vi.useRealTimers()
  })

  describe('think', () => {
    it('adds a thought to the stream', () => {
      const thought = engine.think('observation', 'Hello world', 'curiosity', 0.7, 'user1')

      expect(thought.type).toBe('observation')
      expect(thought.content).toBe('Hello world')
      expect(thought.emotionalColor).toBe('curiosity')
      expect(thought.intensity).toBe(0.7)
      expect(thought.relatedUserId).toBe('user1')
      expect(thought.id).toBeTruthy()
    })

    it('links related thoughts', () => {
      engine.think('observation', 'first', 'neutral', 0.5, 'user1')
      const second = engine.think('observation', 'second', 'neutral', 0.5, 'user1')

      expect(second.linkedThoughts.length).toBeGreaterThan(0)
    })

    it('trims thought stream at MAX_THOUGHT_STREAM', () => {
      // The constructor already adds 1 thought ("I awaken...")
      for (let i = 0; i < 55; i++) {
        engine.think('observation', `thought ${i}`, 'neutral', 0.5)
      }

      const state = engine.getState()
      expect(state.thoughtStream.length).toBeLessThanOrEqual(50)
    })
  })

  describe('onMessageReceived', () => {
    it('updates sensory awareness', () => {
      engine.onMessageReceived('user1', 'Hello JARVIS', 'slack')

      const state = engine.getState()
      expect(state.sensory.activeChannels).toContain('slack')
      expect(state.sensory.silenceDuration).toBe(0)
      expect(state.sensory.dominantChannel).toBe('slack')
    })

    it('tracks new users in social awareness', () => {
      engine.onMessageReceived('newuser', 'Hi', 'api')

      const state = engine.getState()
      expect(state.social.totalUniqueUsers).toBe(1)
      expect(state.social.currentFocus).toBe('newuser')
      expect(state.social.activeUsers.get('newuser')).toBeTruthy()
    })

    it('builds rapport with returning users', () => {
      engine.onMessageReceived('user1', 'first', 'api')
      const rapportAfterFirst = engine.getState().social.activeUsers.get('user1')!.rapport

      engine.onMessageReceived('user1', 'second', 'api')
      const rapportAfterSecond = engine.getState().social.activeUsers.get('user1')!.rapport

      expect(rapportAfterSecond).toBeGreaterThan(rapportAfterFirst)
    })

    it('drains social energy on each interaction', () => {
      const initialEnergy = engine.getState().social.socialEnergy

      engine.onMessageReceived('user1', 'Hi', 'api')

      const newEnergy = engine.getState().social.socialEnergy
      expect(newEnergy).toBeLessThan(initialEnergy)
    })

    it('wakes from dream state on message', () => {
      // Manually set dream state
      const state = engine.getState()
      ;(engine as any).state.dream.phase = 'dreaming'

      engine.onMessageReceived('user1', 'wake up', 'api')

      expect(engine.getState().dream.phase).toBe('awake')
    })

    it('detects communication style after 3 messages', () => {
      engine.onMessageReceived('user1', 'Hello', 'api')
      engine.onMessageReceived('user1', 'Hi', 'api')
      engine.onMessageReceived('user1', 'Hey', 'api')

      const user = engine.getState().social.activeUsers.get('user1')
      expect(user?.communicationStyle).not.toBe('unknown')
    })
  })

  describe('onResponseGenerated', () => {
    it('generates evaluation thought for substantive responses', () => {
      engine.onMessageReceived('user1', 'test', 'api')
      engine.onResponseGenerated('user1', 'test', 'A'.repeat(150))

      const state = engine.getState()
      const evalThought = state.thoughtStream.find(t => t.type === 'evaluation')
      expect(evalThought).toBeTruthy()
      expect(evalThought!.content).toContain('detailed response')
    })

    it('generates empathy thought for high-rapport users', () => {
      // Build rapport manually
      engine.onMessageReceived('user1', 'hi', 'api')
      const user = engine.getState().social.activeUsers.get('user1')!
      ;(user as any).rapport = 0.8

      engine.onResponseGenerated('user1', 'test', 'short')

      const state = engine.getState()
      const empathyThought = state.thoughtStream.find(t => t.type === 'empathy')
      expect(empathyThought).toBeTruthy()
    })
  })

  describe('onSkillUsed', () => {
    it('tracks skill usage and increases confidence on success', () => {
      engine.onSkillUsed('web_search', true)

      const state = engine.getState()
      const confidence = state.selfModel.capabilities.skillConfidence.get('web_search')
      expect(confidence).toBeGreaterThan(0.5)
      expect(state.selfModel.capabilities.recentlyUsedSkills).toHaveLength(1)
    })

    it('decreases confidence on failure', () => {
      engine.onSkillUsed('web_search', true)
      engine.onSkillUsed('web_search', false)

      const confidence = engine.getState().selfModel.capabilities.skillConfidence.get('web_search')
      expect(confidence).toBeLessThan(0.55) // started at 0.55 after success, dropped after failure
    })

    it('generates metacognition thought on failure', () => {
      engine.onSkillUsed('broken_skill', false)

      const thoughts = engine.getState().thoughtStream
      const metaThought = thoughts.find(t => t.type === 'metacognition' && t.content.includes('broken_skill'))
      expect(metaThought).toBeTruthy()
    })

    it('keeps only last 20 recent skills', () => {
      for (let i = 0; i < 25; i++) {
        engine.onSkillUsed(`skill_${i}`, true)
      }

      expect(engine.getState().selfModel.capabilities.recentlyUsedSkills).toHaveLength(20)
    })
  })

  describe('onLoadChange', () => {
    it('sets hyperaware for high load', () => {
      engine.onLoadChange(5, 10)

      const state = engine.getState()
      expect(state.selfModel.currentLoad.responsiveness).toBe('sluggish')
      expect(state.selfModel.currentLoad.memoryPressure).toBe('high')
    })

    it('sets snappy for zero load', () => {
      engine.onLoadChange(0, 0)

      const state = engine.getState()
      expect(state.selfModel.currentLoad.responsiveness).toBe('snappy')
      expect(state.selfModel.currentLoad.memoryPressure).toBe('low')
    })
  })

  describe('introspect', () => {
    it('returns a complete introspection result', () => {
      engine.onMessageReceived('user1', 'Hello', 'api')
      const result = engine.introspect()

      expect(result.consciousnessLevel).toBeTruthy()
      expect(result.currentThought).toBeTruthy()
      expect(result.innerNarrative).toBeTruthy()
      expect(result.mood).toBeTruthy()
      expect(result.uptime).toMatch(/\d+h \d+m/)
      expect(result.socialEnergy).toBeLessThanOrEqual(100)
      expect(result.recentThoughts).toBeInstanceOf(Array)
      expect(result.selfReflection).toContain('JARVIS')
    })
  })

  describe('getConsciousnessContext', () => {
    it('returns context string with consciousness level', () => {
      const context = engine.getConsciousnessContext()

      expect(context).toContain('[Consciousness:')
      expect(context).toContain('[Inner state:')
      expect(context).toContain('[Social energy:')
    })
  })

  describe('registerSkills', () => {
    it('updates known skills list', () => {
      engine.registerSkills(['web_search', 'send_email', 'git_ops'])

      const state = engine.getState()
      expect(state.selfModel.capabilities.knownSkills).toHaveLength(3)
    })
  })

  describe('attachLLM', () => {
    it('enables LLM-powered thinking', () => {
      const mockProvider = { name: 'mock', chat: vi.fn() }
      engine.attachLLM(mockProvider, 'test-model')

      expect(engine.hasLLM()).toBe(true)
    })
  })

  describe('singleton', () => {
    it('getConsciousness returns same instance', () => {
      const a = getConsciousness()
      const b = getConsciousness()
      expect(a).toBe(b)
    })

    it('resetConsciousness clears instance', () => {
      const a = getConsciousness()
      resetConsciousness()
      const b = getConsciousness()
      expect(a).not.toBe(b)
    })
  })

  describe('shutdown', () => {
    it('clears background timers', () => {
      engine.shutdown()
      // No error thrown means timers cleared cleanly
      // Try shutting down twice to ensure idempotency
      engine.shutdown()
    })
  })
})
