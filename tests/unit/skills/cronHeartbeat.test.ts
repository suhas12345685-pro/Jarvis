import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockValidate, mockSchedule } = vi.hoisted(() => ({
  mockValidate: vi.fn().mockReturnValue(true),
  mockSchedule: vi.fn().mockReturnValue({ stop: vi.fn() }),
}))

vi.mock('node-cron', () => ({
  default: { validate: mockValidate, schedule: mockSchedule },
}))

vi.mock('../../../src/logger.js', () => ({
  getLogger: () => ({ info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() }),
}))

import { getSkill } from '../../../src/skills/index.js'
import '../../../src/skills/cronHeartbeat.js'

const ctx: any = { userId: 'u1', channelType: 'test', threadId: 't1', memories: [], sendFinal: vi.fn() }

describe('cronHeartbeat skills', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockValidate.mockReturnValue(true)
  })

  describe('cron_register', () => {
    const skill = getSkill('cron_register')!

    it('registers a valid cron job', async () => {
      const res = await skill.handler({ taskId: 'daily-check', expression: '0 8 * * *', description: 'Check email' }, ctx)
      expect(res.isError).toBe(false)
      expect(res.output).toContain('daily-check')
      expect(res.output).toContain('Check email')
      expect(mockSchedule).toHaveBeenCalledWith('0 8 * * *', expect.any(Function))
    })

    it('rejects invalid cron expression', async () => {
      mockValidate.mockReturnValue(false)
      const res = await skill.handler({ taskId: 'bad', expression: 'not-cron' }, ctx)
      expect(res.isError).toBe(true)
      expect(res.output).toContain('Invalid cron expression')
    })

    it('replaces existing job with same ID', async () => {
      const mockStop = vi.fn()
      mockSchedule.mockReturnValue({ stop: mockStop })

      await skill.handler({ taskId: 'repeat', expression: '0 9 * * *' }, ctx)
      await skill.handler({ taskId: 'repeat', expression: '0 10 * * *' }, ctx)
      expect(mockStop).toHaveBeenCalled()
    })
  })

  describe('cron_unregister', () => {
    const skill = getSkill('cron_unregister')!

    it('cancels existing job', async () => {
      const mockStop = vi.fn()
      mockSchedule.mockReturnValue({ stop: mockStop })

      const regSkill = getSkill('cron_register')!
      await regSkill.handler({ taskId: 'to-cancel', expression: '0 8 * * *' }, ctx)

      const res = await skill.handler({ taskId: 'to-cancel' }, ctx)
      expect(res.isError).toBe(false)
      expect(res.output).toContain('cancelled')
      expect(mockStop).toHaveBeenCalled()
    })

    it('returns error for non-existent task', async () => {
      const res = await skill.handler({ taskId: 'nonexistent' }, ctx)
      expect(res.isError).toBe(true)
      expect(res.output).toContain('No task found')
    })
  })

  describe('cron_list', () => {
    const skill = getSkill('cron_list')!

    it('lists registered tasks', async () => {
      const regSkill = getSkill('cron_register')!
      await regSkill.handler({ taskId: 'list-test', expression: '0 8 * * *' }, ctx)

      const res = await skill.handler({}, ctx)
      expect(res.isError).toBe(false)
      expect(res.output).toContain('list-test')
    })
  })
})
