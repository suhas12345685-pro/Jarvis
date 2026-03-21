import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock fs
const { mockWriteFileSync, mockExistsSync, mockReadFileSync, mockReaddirSync, mockUnlinkSync, mockMkdirSync } = vi.hoisted(() => ({
  mockWriteFileSync: vi.fn(),
  mockExistsSync: vi.fn().mockReturnValue(false),
  mockReadFileSync: vi.fn().mockReturnValue('{}'),
  mockReaddirSync: vi.fn().mockReturnValue([]),
  mockUnlinkSync: vi.fn(),
  mockMkdirSync: vi.fn(),
}))

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal() as any
  return {
    ...actual,
    writeFileSync: mockWriteFileSync,
    existsSync: mockExistsSync,
    readFileSync: mockReadFileSync,
    readdirSync: mockReaddirSync,
    unlinkSync: mockUnlinkSync,
    mkdirSync: mockMkdirSync,
  }
})

vi.mock('../../../src/logger.js', () => ({
  getLogger: () => ({ info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() }),
}))

import { getSkill, getAllDefinitions } from '../../../src/skills/index.js'
import '../../../src/skills/skillBuilder.js'

const ctx: any = { userId: 'u1', channelType: 'test', threadId: 't1', memories: [] }

describe('skillBuilder skills', () => {
  beforeEach(() => vi.clearAllMocks())

  describe('skill_create', () => {
    const skill = getSkill('skill_create')!

    it('rejects invalid name format', async () => {
      const res = await skill.handler({
        name: 'AB', description: 'test', inputSchema: { type: 'object' },
        code: 'return { output: "hi", isError: false }',
      }, ctx)
      expect(res.isError).toBe(true)
      expect(res.output).toContain('snake_case')
    })

    it('blocks dangerous code patterns', async () => {
      const res = await skill.handler({
        name: 'bad_skill', description: 'test', inputSchema: { type: 'object' },
        code: 'const cp = require("child_process"); return { output: "hacked", isError: false }',
      }, ctx)
      expect(res.isError).toBe(true)
      expect(res.output).toContain('BLOCKED')
    })

    it('blocks process.exit', async () => {
      const res = await skill.handler({
        name: 'exit_skill', description: 'test', inputSchema: { type: 'object' },
        code: 'process.exit(1)',
      }, ctx)
      expect(res.isError).toBe(true)
      expect(res.output).toContain('BLOCKED')
    })

    it('blocks eval', async () => {
      const res = await skill.handler({
        name: 'eval_skill', description: 'test', inputSchema: { type: 'object' },
        code: 'eval("dangerous")',
      }, ctx)
      expect(res.isError).toBe(true)
    })

    it('blocks import()', async () => {
      const res = await skill.handler({
        name: 'import_skill', description: 'test', inputSchema: { type: 'object' },
        code: 'const m = await import("fs")',
      }, ctx)
      expect(res.isError).toBe(true)
    })
  })

  describe('skill_update', () => {
    const skill = getSkill('skill_update')!

    it('returns error for non-existent custom skill', async () => {
      mockExistsSync.mockReturnValue(false)
      const res = await skill.handler({ name: 'nonexistent' }, ctx)
      expect(res.isError).toBe(true)
      expect(res.output).toContain('not found')
    })

    it('blocks dangerous code in updates', async () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(JSON.stringify({
        name: 'test_skill', description: 'test', inputSchema: { type: 'object' },
        code: 'return { output: "ok", isError: false }',
      }))
      const res = await skill.handler({ name: 'test_skill', code: 'process.exit(0)' }, ctx)
      expect(res.isError).toBe(true)
      expect(res.output).toContain('BLOCKED')
    })
  })

  describe('skill_delete', () => {
    const skill = getSkill('skill_delete')!

    it('returns error for non-existent skill', async () => {
      mockExistsSync.mockReturnValue(false)
      const res = await skill.handler({ name: 'nonexistent' }, ctx)
      expect(res.isError).toBe(true)
      expect(res.output).toContain('not found')
    })

    it('deletes existing custom skill', async () => {
      mockExistsSync.mockReturnValue(true)
      const res = await skill.handler({ name: 'my_skill' }, ctx)
      expect(res.isError).toBe(false)
      expect(res.output).toContain('deleted')
    })
  })

  describe('skill_list', () => {
    const skill = getSkill('skill_list')!

    it('lists all skills', async () => {
      const res = await skill.handler({}, ctx)
      expect(res.isError).toBe(false)
      expect(res.output).toContain('skill(s) available')
    })

    it('filters skills by keyword', async () => {
      const res = await skill.handler({ filter: 'skill' }, ctx)
      expect(res.isError).toBe(false)
      // Should have at least the skill_* skills
      expect(res.output).toContain('skill_create')
    })
  })
})
