import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import type { AgentContext } from '../../../src/types/index.js'

vi.mock('../../../src/logger.js', () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

// Use real EmotionEngine for integration testing
import { resetEmotionEngine } from '../../../src/emotionEngine.js'

beforeAll(async () => {
  await import('../../../src/skills/emotionSkills.js')
})

const mockCtx: AgentContext = {
  channelType: 'api',
  userId: 'test-user',
  threadId: 'test',
  rawMessage: '',
  memories: [],
  systemPrompt: '',
  byoak: [],
  sendInterim: async () => undefined,
  sendFinal: async () => {},
}

describe('emotionSkills', async () => {
  const { getSkill } = await import('../../../src/skills/index.js')

  beforeEach(() => {
    resetEmotionEngine()
  })

  describe('detect_emotion', () => {
    it('detects emotion from positive message', async () => {
      const skill = getSkill('detect_emotion')!
      const result = await skill.handler({
        message: 'This is amazing and wonderful!',
      }, mockCtx)

      expect(result.isError).toBe(false)
      expect(result.output).toContain('Emotional Analysis')
      expect(result.output).toContain('Sentiment: positive')
    })

    it('detects emotion from negative message', async () => {
      const skill = getSkill('detect_emotion')!
      const result = await skill.handler({
        message: 'This is terrible and broken',
      }, mockCtx)

      expect(result.isError).toBe(false)
      expect(result.output).toContain('negative')
    })

    it('handles neutral messages', async () => {
      const skill = getSkill('detect_emotion')!
      const result = await skill.handler({
        message: 'The file is at this path',
      }, mockCtx)

      expect(result.isError).toBe(false)
      expect(result.output).toContain('Emotional Analysis')
    })

    it('includes mood and trend info', async () => {
      const skill = getSkill('detect_emotion')!
      const result = await skill.handler({
        message: 'I love this so much!',
      }, mockCtx)

      expect(result.output).toContain('User Mood')
      expect(result.output).toContain('Recent Trend')
    })
  })

  describe('set_personality', () => {
    it('sets personality traits', async () => {
      const skill = getSkill('set_personality')!
      const result = await skill.handler({
        warmthLevel: 0.9,
        humorLevel: 0.8,
        formalityLevel: 0.2,
        empathyLevel: 0.95,
        traits: ['playful', 'warm', 'witty'],
      }, mockCtx)

      expect(result.isError).toBe(false)
      expect(result.output).toContain('Personality updated')
      expect(result.output).toContain('playful')
      expect(result.output).toContain('90%') // warmth
    })

    it('uses defaults when no values provided', async () => {
      const skill = getSkill('set_personality')!
      const result = await skill.handler({}, mockCtx)

      expect(result.isError).toBe(false)
      expect(result.output).toContain('Personality updated')
      expect(result.output).toContain('helpful')
    })
  })

  describe('get_emotional_state', () => {
    it('returns emotional state for current user', async () => {
      const skill = getSkill('get_emotional_state')!
      const result = await skill.handler({}, mockCtx)

      expect(result.isError).toBe(false)
      expect(result.output).toContain('Emotional State')
      expect(result.output).toContain('test-user')
      expect(result.output).toContain('Current Emotion')
      expect(result.output).toContain('Personality')
    })

    it('includes personality details', async () => {
      const skill = getSkill('get_emotional_state')!
      const result = await skill.handler({}, mockCtx)

      expect(result.output).toContain('Warmth')
      expect(result.output).toContain('Humor')
      expect(result.output).toContain('Formality')
    })

    it('reflects personality changes', async () => {
      // Set personality first
      const setSkill = getSkill('set_personality')!
      await setSkill.handler({ warmthLevel: 0.1, traits: ['analytical'] }, mockCtx)

      // Then get state
      const getSkillFn = getSkill('get_emotional_state')!
      const result = await getSkillFn.handler({}, mockCtx)

      expect(result.output).toContain('analytical')
      expect(result.output).toContain('10%') // warmth
    })
  })
})
