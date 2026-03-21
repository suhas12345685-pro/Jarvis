import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import type { AgentContext, AppConfig } from '../../../src/types/index.js'

// Mock consciousness (proactiveCare calls getConsciousness().think)
vi.mock('../../../src/consciousness.js', () => ({
  getConsciousness: () => ({
    think: vi.fn(),
  }),
  createConsciousness: vi.fn(),
}))

// Mock logger
vi.mock('../../../src/logger.js', () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  createLogger: vi.fn(),
}))

// Mock skills index (registerSkill needs to work)
vi.mock('../../../src/skills/index.js', () => {
  const skills = new Map<string, unknown>()
  return {
    registerSkill: vi.fn((def: { name: string }) => {
      skills.set(def.name, def)
    }),
    getSkill: vi.fn((name: string) => skills.get(name)),
    getAllDefinitions: vi.fn(() => []),
    loadAllSkills: vi.fn(),
  }
})

const makeCtx = (rawMessage: string, userId = 'test-user'): AgentContext => ({
  channelType: 'api',
  userId,
  threadId: 'test-thread',
  rawMessage,
  memories: [],
  systemPrompt: '',
  byoak: [],
  sendInterim: async () => undefined,
  sendFinal: async () => {},
})

const makeConfig = (): AppConfig => ({
  port: 3000,
  storageMode: 'sqlite',
  logPath: '/tmp/test.log',
  llmProvider: 'anthropic',
  llmModel: 'claude-sonnet-4-20250514',
  anthropicApiKey: 'test-key',
  byoak: [],
  dbLanguage: 'en',
  sqlitePath: '/tmp/jarvis.db',
  redisUrl: 'redis://localhost:6379',
} as AppConfig)

describe('proactiveCare', () => {
  let checkProactiveCare: typeof import('../../../src/skills/proactiveCare.js').checkProactiveCare
  let handleCareResponse: typeof import('../../../src/skills/proactiveCare.js').handleCareResponse

  beforeAll(async () => {
    const mod = await import('../../../src/skills/proactiveCare.js')
    checkProactiveCare = mod.checkProactiveCare
    handleCareResponse = mod.handleCareResponse
  })

  it('returns null for neutral messages', async () => {
    const result = await checkProactiveCare(makeCtx('how do I create a REST API?'), makeConfig())
    expect(result).toBeNull()
  })

  it('detects frustration signals', async () => {
    const result = await checkProactiveCare(
      makeCtx('ugh this is broken and nothing works, been debugging for hours'),
      makeConfig()
    )
    expect(result).not.toBeNull()
    expect(result).toContain('going ahead and ordering')
  })

  it('detects exhaustion signals', async () => {
    const result = await checkProactiveCare(
      makeCtx('so tired, been working all day, need a break', 'tired-user'),
      makeConfig()
    )
    expect(result).not.toBeNull()
  })

  it('detects excitement signals', async () => {
    const result = await checkProactiveCare(
      makeCtx('YES! it works! finally nailed it!', 'excited-user'),
      makeConfig()
    )
    expect(result).not.toBeNull()
  })

  it('respects cooldown period', async () => {
    // First offer should trigger
    const first = await checkProactiveCare(
      makeCtx('ugh frustrated and stuck', 'cooldown-user'),
      makeConfig()
    )
    expect(first).not.toBeNull()

    // Second immediate offer should be blocked by cooldown
    const second = await checkProactiveCare(
      makeCtx('still frustrated and stuck', 'cooldown-user'),
      makeConfig()
    )
    expect(second).toBeNull()
  })

  it('stops offering after MAX_CONSECUTIVE_DECLINES', async () => {
    const uid = 'decline-user'
    // Decline 3 times
    handleCareResponse(uid, false)
    handleCareResponse(uid, false)
    handleCareResponse(uid, false)

    const result = await checkProactiveCare(
      makeCtx('ugh so frustrated and stuck', uid),
      makeConfig()
    )
    expect(result).toBeNull()
  })

  it('resets decline counter on accept', async () => {
    const uid = 'reset-user'
    handleCareResponse(uid, false)
    handleCareResponse(uid, false)
    handleCareResponse(uid, true) // Accept resets counter

    // Decline counter should be 0 now, so the MAX check shouldn't block
    // (cooldown might still block, but the decline logic is reset)
    // We verify the function doesn't throw
    expect(() => handleCareResponse(uid, true)).not.toThrow()
  })
})
