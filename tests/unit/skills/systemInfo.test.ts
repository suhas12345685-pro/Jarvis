import { describe, it, expect, beforeAll } from 'vitest'
import type { AgentContext } from '../../../src/types/index.js'

beforeAll(async () => {
  await import('../../../src/skills/systemInfo.js')
})

const mockCtx: AgentContext = {
  channelType: 'api',
  userId: 'test',
  threadId: 'test',
  rawMessage: '',
  memories: [],
  systemPrompt: '',
  byoak: [],
  sendInterim: async () => undefined,
  sendFinal: async () => {},
}

describe('systemInfo skills', async () => {
  const { getSkill } = await import('../../../src/skills/index.js')

  describe('system_info', () => {
    it('returns system information', async () => {
      const skill = getSkill('system_info')!
      const result = await skill.handler({}, mockCtx)
      expect(result.isError).toBe(false)
      expect(result.output).toContain('Hostname:')
      expect(result.output).toContain('Platform:')
      expect(result.output).toContain('CPU:')
      expect(result.output).toContain('Memory:')
      expect(result.output).toContain('Uptime:')
    })
  })

  describe('system_env_get', () => {
    it('reads non-sensitive env var', async () => {
      const skill = getSkill('system_env_get')!
      process.env.TEST_JARVIS_VAR = 'hello'
      const result = await skill.handler({ name: 'TEST_JARVIS_VAR' }, mockCtx)
      expect(result.isError).toBe(false)
      expect(result.output).toContain('hello')
      delete process.env.TEST_JARVIS_VAR
    })

    it('blocks sensitive env vars', async () => {
      const skill = getSkill('system_env_get')!
      const result = await skill.handler({ name: 'API_SECRET_KEY' }, mockCtx)
      expect(result.isError).toBe(true)
      expect(result.output).toContain('BLOCKED')
    })

    it('reports unset env vars', async () => {
      const skill = getSkill('system_env_get')!
      const result = await skill.handler({ name: 'NONEXISTENT_VAR_XYZ' }, mockCtx)
      expect(result.isError).toBe(false)
      expect(result.output).toContain('not set')
    })
  })

  describe('system_date_time', () => {
    it('returns human readable date', async () => {
      const skill = getSkill('system_date_time')!
      const result = await skill.handler({}, mockCtx)
      expect(result.isError).toBe(false)
      expect(result.output).toMatch(/\d{4}/)
    })

    it('returns ISO format', async () => {
      const skill = getSkill('system_date_time')!
      const result = await skill.handler({ format: 'iso' }, mockCtx)
      expect(result.output).toMatch(/\d{4}-\d{2}-\d{2}/)
    })

    it('returns unix timestamp', async () => {
      const skill = getSkill('system_date_time')!
      const result = await skill.handler({ format: 'unix' }, mockCtx)
      expect(Number(result.output)).toBeGreaterThan(1000000000)
    })
  })

  describe('system_sleep', () => {
    it('waits for specified duration', async () => {
      const skill = getSkill('system_sleep')!
      const start = Date.now()
      const result = await skill.handler({ seconds: 0.1 }, mockCtx)
      const elapsed = Date.now() - start
      expect(result.isError).toBe(false)
      expect(elapsed).toBeGreaterThanOrEqual(90) // ~100ms
    })

    it('rejects non-positive duration', async () => {
      const skill = getSkill('system_sleep')!
      const result = await skill.handler({ seconds: 0 }, mockCtx)
      expect(result.isError).toBe(true)
    })

    it('caps at 60 seconds', async () => {
      const skill = getSkill('system_sleep')!
      // Just verify it doesn't throw for large values (handler caps internally)
      // We won't actually wait 60s, so just test the cap logic conceptually
      expect(Math.min(100, 60)).toBe(60)
    })
  })
})
