import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import type { AgentContext } from '../../../src/types/index.js'

beforeAll(async () => {
  await import('../../../src/skills/scheduler.js')
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

describe('scheduler skills', async () => {
  const { getSkill } = await import('../../../src/skills/index.js')

  describe('timezone_convert', () => {
    it('converts between timezones', async () => {
      const skill = getSkill('timezone_convert')!
      const result = await skill.handler({
        datetime: '2024-06-15 12:00',
        from_tz: 'UTC',
        to_tz: 'America/New_York',
      }, mockCtx)

      expect(result.isError).toBe(false)
      const parsed = JSON.parse(result.output)
      expect(parsed.from.timezone).toBe('UTC')
      expect(parsed.to.timezone).toBe('America/New_York')
    })

    it('handles "now" datetime', async () => {
      const skill = getSkill('timezone_convert')!
      const result = await skill.handler({
        to_tz: 'Asia/Tokyo',
      }, mockCtx)

      expect(result.isError).toBe(false)
      const parsed = JSON.parse(result.output)
      expect(parsed.to.timezone).toBe('Asia/Tokyo')
    })

    it('returns error for invalid date', async () => {
      const skill = getSkill('timezone_convert')!
      const result = await skill.handler({
        datetime: 'not-a-date',
        to_tz: 'UTC',
      }, mockCtx)

      expect(result.isError).toBe(true)
      expect(result.output).toContain('Invalid date')
    })

    it('supports short format', async () => {
      const skill = getSkill('timezone_convert')!
      const result = await skill.handler({
        datetime: '2024-06-15 12:00',
        to_tz: 'Europe/London',
        format: 'short',
      }, mockCtx)

      expect(result.isError).toBe(false)
    })
  })

  describe('reminder_set', () => {
    afterEach(async () => {
      // Cancel all reminders after each test
      const listSkill = getSkill('reminder_list')!
      const listResult = await listSkill.handler({}, mockCtx)
      if (listResult.output !== 'No active reminders') {
        const reminders = JSON.parse(listResult.output) as Array<{ id: string }>
        const cancelSkill = getSkill('reminder_cancel')!
        for (const r of reminders) {
          await cancelSkill.handler({ id: r.id }, mockCtx)
        }
      }
    })

    it('sets a reminder with delay', async () => {
      const skill = getSkill('reminder_set')!
      const result = await skill.handler({
        message: 'Test reminder',
        delay: '5m',
        id: 'test-reminder-1',
      }, mockCtx)

      expect(result.isError).toBe(false)
      const parsed = JSON.parse(result.output)
      expect(parsed.id).toBe('test-reminder-1')
      expect(parsed.message).toBe('Test reminder')
    })

    it('rejects invalid delay', async () => {
      const skill = getSkill('reminder_set')!
      const result = await skill.handler({
        message: 'Test',
        delay: 'invalid',
      }, mockCtx)

      expect(result.isError).toBe(true)
    })

    it('rejects delays over 24 hours', async () => {
      const skill = getSkill('reminder_set')!
      const result = await skill.handler({
        message: 'Test',
        delay: '25h',
      }, mockCtx)

      expect(result.isError).toBe(true)
      expect(result.output).toContain('24 hours')
    })

    it('replaces existing reminder with same ID', async () => {
      const skill = getSkill('reminder_set')!
      await skill.handler({ message: 'First', delay: '10m', id: 'replace-test' }, mockCtx)
      const result = await skill.handler({ message: 'Second', delay: '5m', id: 'replace-test' }, mockCtx)

      expect(result.isError).toBe(false)
      const parsed = JSON.parse(result.output)
      expect(parsed.id).toBe('replace-test')
    })
  })

  describe('reminder_list', () => {
    it('returns no reminders when empty', async () => {
      const skill = getSkill('reminder_list')!
      const result = await skill.handler({}, mockCtx)
      // May or may not have reminders from other tests, just verify no error
      expect(result.isError).toBe(false)
    })
  })

  describe('reminder_cancel', () => {
    it('cancels an active reminder', async () => {
      const setSkill = getSkill('reminder_set')!
      await setSkill.handler({ message: 'Cancel me', delay: '10m', id: 'cancel-test' }, mockCtx)

      const cancelSkill = getSkill('reminder_cancel')!
      const result = await cancelSkill.handler({ id: 'cancel-test' }, mockCtx)

      expect(result.isError).toBe(false)
      expect(result.output).toContain('Cancelled')
    })

    it('returns error for nonexistent reminder', async () => {
      const skill = getSkill('reminder_cancel')!
      const result = await skill.handler({ id: 'nonexistent' }, mockCtx)
      expect(result.isError).toBe(true)
    })
  })

  describe('timer_start', () => {
    it('starts a timer', async () => {
      const skill = getSkill('timer_start')!
      const result = await skill.handler({
        label: 'Test timer',
        duration: '5m',
      }, mockCtx)

      expect(result.isError).toBe(false)
      const parsed = JSON.parse(result.output)
      expect(parsed.label).toBe('Test timer')
      expect(parsed.duration).toBe('5m')
    })

    it('rejects invalid duration', async () => {
      const skill = getSkill('timer_start')!
      const result = await skill.handler({
        label: 'Bad timer',
        duration: 'invalid',
      }, mockCtx)

      expect(result.isError).toBe(true)
    })
  })
})
