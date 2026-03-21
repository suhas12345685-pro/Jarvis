import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockRegister, mockUnregister, mockList, mockGet } = vi.hoisted(() => ({
  mockRegister: vi.fn(),
  mockUnregister: vi.fn().mockReturnValue(true),
  mockList: vi.fn().mockReturnValue([]),
  mockGet: vi.fn().mockReturnValue(null),
}))

vi.mock('../../../src/proactiveEngine.js', () => ({
  registerProactiveTask: mockRegister,
  unregisterProactiveTask: mockUnregister,
  listProactiveTasks: mockList,
  getProactiveTask: mockGet,
}))

import { getSkill } from '../../../src/skills/index.js'
import '../../../src/skills/proactive.js'

const ctx: any = { userId: 'u1', channelType: 'slack', threadId: 't1', memories: [] }

describe('proactive skills', () => {
  beforeEach(() => vi.clearAllMocks())

  describe('proactive_create_task', () => {
    const skill = getSkill('proactive_create_task')!

    it('creates a proactive task', async () => {
      const res = await skill.handler({
        name: 'Daily Check',
        trigger: 'cron:0 9 * * *',
        prompt: 'Check email and summarize',
      }, ctx)
      expect(res.isError).toBe(false)
      expect(res.output).toContain('Daily Check')
      expect(res.output).toContain('cron:0 9 * * *')
      expect(mockRegister).toHaveBeenCalledWith(expect.objectContaining({
        name: 'Daily Check',
        trigger: 'cron:0 9 * * *',
        prompt: 'Check email and summarize',
        userId: 'u1',
        enabled: true,
      }))
    })
  })

  describe('proactive_list_tasks', () => {
    const skill = getSkill('proactive_list_tasks')!

    it('lists tasks when available', async () => {
      mockList.mockReturnValue([
        { name: 'Task 1', id: 'id-1', trigger: 'cron:0 9 * * *', enabled: true, lastRun: null },
        { name: 'Task 2', id: 'id-2', trigger: 'interval:30m', enabled: false, lastRun: new Date('2025-01-01') },
      ])
      const res = await skill.handler({}, ctx)
      expect(res.isError).toBe(false)
      expect(res.output).toContain('Task 1')
      expect(res.output).toContain('Task 2')
      expect(res.output).toContain('2 proactive task(s)')
    })

    it('handles no tasks', async () => {
      mockList.mockReturnValue([])
      const res = await skill.handler({}, ctx)
      expect(res.output).toContain('No proactive tasks')
    })
  })

  describe('proactive_toggle_task', () => {
    const skill = getSkill('proactive_toggle_task')!

    it('enables a task', async () => {
      const task = { name: 'Test', enabled: false }
      mockGet.mockReturnValue(task)
      const res = await skill.handler({ taskId: 'id-1', enabled: true }, ctx)
      expect(res.isError).toBe(false)
      expect(task.enabled).toBe(true)
    })

    it('disables a task', async () => {
      const task = { name: 'Test', enabled: true }
      mockGet.mockReturnValue(task)
      const res = await skill.handler({ taskId: 'id-1', enabled: false }, ctx)
      expect(task.enabled).toBe(false)
      expect(res.output).toContain('disabled')
    })

    it('returns error for nonexistent task', async () => {
      mockGet.mockReturnValue(null)
      const res = await skill.handler({ taskId: 'bad-id', enabled: true }, ctx)
      expect(res.isError).toBe(true)
    })
  })

  describe('proactive_delete_task', () => {
    const skill = getSkill('proactive_delete_task')!

    it('deletes a task', async () => {
      mockUnregister.mockReturnValue(true)
      const res = await skill.handler({ taskId: 'id-1' }, ctx)
      expect(res.isError).toBe(false)
      expect(res.output).toContain('deleted')
    })

    it('returns error for nonexistent task', async () => {
      mockUnregister.mockReturnValue(false)
      const res = await skill.handler({ taskId: 'bad-id' }, ctx)
      expect(res.isError).toBe(true)
    })
  })
})
