import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/logger.js', () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

vi.mock('../../src/toolCaller.js', () => ({
  runToolLoop: vi.fn().mockResolvedValue('Proactive result'),
}))

vi.mock('node-cron', () => ({
  validate: vi.fn((expr: string) => /^\S+ \S+ \S+ \S+ \S+$/.test(expr)),
  schedule: vi.fn(() => ({
    stop: vi.fn(),
  })),
}))

import {
  registerProactiveTask,
  unregisterProactiveTask,
  listProactiveTasks,
  getProactiveTask,
  initProactiveEngine,
  shutdownProactiveEngine,
  type ProactiveTask,
} from '../../src/proactiveEngine.js'

describe('ProactiveEngine', () => {
  beforeEach(() => {
    shutdownProactiveEngine()
  })

  const makeTask = (overrides?: Partial<ProactiveTask>): ProactiveTask => ({
    id: `test-${Date.now()}`,
    name: 'Test Task',
    description: 'A test proactive task',
    trigger: 'interval:5m',
    prompt: 'Do something',
    channel: 'api',
    channelPayload: {},
    userId: 'user1',
    enabled: true,
    createdAt: new Date(),
    ...overrides,
  })

  describe('registerProactiveTask', () => {
    it('registers a task', () => {
      const task = makeTask({ id: 'reg-1' })
      registerProactiveTask(task)

      expect(getProactiveTask('reg-1')).toBeTruthy()
      expect(getProactiveTask('reg-1')!.name).toBe('Test Task')
    })

    it('schedules interval tasks', () => {
      const task = makeTask({ id: 'interval-1', trigger: 'interval:10m' })
      registerProactiveTask(task)

      expect(getProactiveTask('interval-1')).toBeTruthy()
    })

    it('schedules cron tasks', () => {
      const task = makeTask({ id: 'cron-1', trigger: 'cron:0 9 * * 1-5' })
      registerProactiveTask(task)

      expect(getProactiveTask('cron-1')).toBeTruthy()
    })
  })

  describe('unregisterProactiveTask', () => {
    it('removes a registered task', () => {
      const task = makeTask({ id: 'unreg-1' })
      registerProactiveTask(task)

      const removed = unregisterProactiveTask('unreg-1')
      expect(removed).toBe(true)
      expect(getProactiveTask('unreg-1')).toBeUndefined()
    })

    it('returns false for nonexistent task', () => {
      expect(unregisterProactiveTask('nonexistent')).toBe(false)
    })
  })

  describe('listProactiveTasks', () => {
    it('returns all registered tasks', () => {
      registerProactiveTask(makeTask({ id: 'list-1' }))
      registerProactiveTask(makeTask({ id: 'list-2' }))

      const tasks = listProactiveTasks()
      expect(tasks.length).toBeGreaterThanOrEqual(2)
      expect(tasks.find(t => t.id === 'list-1')).toBeTruthy()
      expect(tasks.find(t => t.id === 'list-2')).toBeTruthy()
    })
  })

  describe('getProactiveTask', () => {
    it('returns task by ID', () => {
      registerProactiveTask(makeTask({ id: 'get-1', name: 'Get Task' }))
      const task = getProactiveTask('get-1')
      expect(task).toBeTruthy()
      expect(task!.name).toBe('Get Task')
    })

    it('returns undefined for unknown ID', () => {
      expect(getProactiveTask('unknown')).toBeUndefined()
    })
  })

  describe('initProactiveEngine', () => {
    it('registers default tasks', async () => {
      const mockMemory = { semanticSearch: vi.fn(), insertMemory: vi.fn() }
      const mockConfig = { byoak: [] } as any
      const mockCallback = vi.fn()

      await initProactiveEngine(mockConfig, mockMemory as any, mockCallback)

      const tasks = listProactiveTasks()
      expect(tasks.length).toBeGreaterThanOrEqual(1)

      // Default tasks should include knowledge-sync
      const knowledgeSync = tasks.find(t => t.id === 'knowledge-sync')
      expect(knowledgeSync).toBeTruthy()
      expect(knowledgeSync!.enabled).toBe(true)
    })
  })

  describe('shutdownProactiveEngine', () => {
    it('clears all tasks and timers', () => {
      registerProactiveTask(makeTask({ id: 'shutdown-1' }))
      registerProactiveTask(makeTask({ id: 'shutdown-2' }))

      shutdownProactiveEngine()

      expect(listProactiveTasks()).toHaveLength(0)
    })

    it('is idempotent', () => {
      shutdownProactiveEngine()
      shutdownProactiveEngine()
      // Should not throw
    })
  })
})
