import { describe, it, expect, vi, beforeAll } from 'vitest'

vi.mock('../../../src/logger.js', () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

vi.mock('../../../src/emotionEngine.js', () => ({
  getEmotionEngine: () => ({
    getOrCreateState: () => ({ primary: 'neutral', intensity: 0.5, mood: 'content' }),
  }),
}))

vi.mock('../../../src/consciousness.js', () => ({
  getConsciousness: () => ({
    introspect: () => ({
      consciousnessLevel: 'alert',
      currentThought: 'Processing the current moment',
      innerNarrative: 'All systems nominal',
      mood: 'content',
      emotionalColor: 'serenity',
      uptime: '2h 15m',
      socialEnergy: 75,
      dreamState: 'awake',
      selfReflection: 'I am JARVIS, constantly evolving.',
      recentThoughts: [
        { type: 'observation', content: 'User is testing me', timestamp: new Date(), emotionalColor: 'neutral', relatedUserId: 'user1' },
        { type: 'reflection', content: 'I should be helpful', timestamp: new Date(), emotionalColor: 'trust' },
      ],
    }),
    getState: () => ({
      level: 'alert',
      innerNarrative: 'All systems nominal',
      thoughtStream: [
        { type: 'observation', content: 'Test thought', timestamp: new Date(), emotionalColor: 'neutral', intensity: 0.5 },
      ],
      selfModel: {
        identity: {
          name: 'J.A.R.V.I.S.',
          purpose: 'To serve as an intelligent assistant',
          coreTraits: ['helpful', 'witty', 'precise'],
          creationNarrative: 'Born from code, shaped by interaction.',
        },
        values: ['truthfulness', 'service', 'growth'],
        capabilities: {
          knownSkills: ['web_search'],
          limitations: ['I cannot access physical world directly'],
          recentlyUsedSkills: [
            { name: 'web_search', success: true },
            { name: 'file_read', success: true },
            { name: 'broken_skill', success: false },
          ],
        },
      },
      social: {
        socialEnergy: 0.75,
        totalUniqueUsers: 3,
        currentFocus: 'user1',
        activeUsers: new Map([
          ['user1', { userId: 'user1', messageCount: 15, rapport: 0.8, communicationStyle: 'casual' }],
          ['user2', { userId: 'user2', messageCount: 5, rapport: 0.4, communicationStyle: 'formal' }],
        ]),
      },
      dream: { phase: 'awake' },
    }),
    think: vi.fn(),
  }),
}))

beforeAll(async () => {
  await import('../../../src/skills/consciousnessSkills.js')
})

const mockCtx: any = {
  channelType: 'api',
  userId: 'user1',
  threadId: 'test',
  rawMessage: '',
  memories: [],
  systemPrompt: '',
  byoak: [],
  sendInterim: async () => undefined,
  sendFinal: async () => {},
}

describe('consciousnessSkills', async () => {
  const { getSkill } = await import('../../../src/skills/index.js')

  describe('introspect', () => {
    it('returns full consciousness report by default', async () => {
      const skill = getSkill('introspect')!
      const result = await skill.handler({}, mockCtx)

      expect(result.isError).toBe(false)
      expect(result.output).toContain('Consciousness Report')
      expect(result.output).toContain('alert')
      expect(result.output).toContain('content')
    })

    it('returns thoughts aspect', async () => {
      const skill = getSkill('introspect')!
      const result = await skill.handler({ aspect: 'thoughts' }, mockCtx)

      expect(result.output).toContain('Current thought')
      expect(result.output).toContain('Inner narrative')
      expect(result.output).toContain('Recent thought stream')
    })

    it('returns mood aspect', async () => {
      const skill = getSkill('introspect')!
      const result = await skill.handler({ aspect: 'mood' }, mockCtx)

      expect(result.output).toContain('Mood:')
      expect(result.output).toContain('Social energy:')
    })

    it('returns dreams aspect', async () => {
      const skill = getSkill('introspect')!
      const result = await skill.handler({ aspect: 'dreams' }, mockCtx)

      expect(result.output).toContain('Dream state: awake')
      expect(result.output).toContain('awake')
    })

    it('returns identity aspect', async () => {
      const skill = getSkill('introspect')!
      const result = await skill.handler({ aspect: 'identity' }, mockCtx)

      expect(result.output).toContain('J.A.R.V.I.S.')
      expect(result.output).toContain('Purpose')
      expect(result.output).toContain('Core traits')
    })

    it('returns social aspect', async () => {
      const skill = getSkill('introspect')!
      const result = await skill.handler({ aspect: 'social' }, mockCtx)

      expect(result.output).toContain('Social energy:')
      expect(result.output).toContain('Total unique users: 3')
      expect(result.output).toContain('user1')
    })
  })

  describe('thought_stream', () => {
    it('returns recent thoughts', async () => {
      const skill = getSkill('thought_stream')!
      const result = await skill.handler({}, mockCtx)

      expect(result.isError).toBe(false)
      expect(result.output).toContain('Stream of Consciousness')
    })

    it('respects count parameter', async () => {
      const skill = getSkill('thought_stream')!
      const result = await skill.handler({ count: 1 }, mockCtx)

      expect(result.isError).toBe(false)
    })

    it('filters by thought type', async () => {
      const skill = getSkill('thought_stream')!
      const result = await skill.handler({ filter: 'observation' }, mockCtx)

      expect(result.isError).toBe(false)
    })

    it('handles empty filtered results', async () => {
      const skill = getSkill('thought_stream')!
      const result = await skill.handler({ filter: 'dream' }, mockCtx)

      expect(result.output).toContain('quiet')
    })
  })

  describe('self_reflect', () => {
    it('returns self-reflection report', async () => {
      const skill = getSkill('self_reflect')!
      const result = await skill.handler({}, mockCtx)

      expect(result.isError).toBe(false)
      expect(result.output).toContain('Self-Reflection')
      expect(result.output).toContain('purpose')
    })

    it('reflects on specific topic', async () => {
      const skill = getSkill('self_reflect')!
      const result = await skill.handler({ topic: 'my limitations' }, mockCtx)

      expect(result.output).toContain('limitations')
      expect(result.output).toContain('physical world')
    })

    it('includes performance patterns', async () => {
      const skill = getSkill('self_reflect')!
      const result = await skill.handler({ topic: 'pattern' }, mockCtx)

      expect(result.output).toContain('skill executions')
      expect(result.output).toContain('success rate')
    })
  })
})
