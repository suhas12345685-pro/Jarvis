import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockExecSync, mockStatSync, mockExistsSync } = vi.hoisted(() => ({
  mockExecSync: vi.fn().mockReturnValue(''),
  mockStatSync: vi.fn().mockReturnValue({ size: 2048 }),
  mockExistsSync: vi.fn().mockReturnValue(true),
}))

vi.mock('child_process', () => ({ execSync: mockExecSync }))
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal() as any
  return { ...actual, statSync: mockStatSync, existsSync: mockExistsSync }
})
vi.mock('../../../src/security.js', () => ({
  escapeShellArg: (s: string) => `'${s}'`,
}))

import { getSkill } from '../../../src/skills/index.js'
import '../../../src/skills/archive.js'

const ctx: any = { userId: 'u1', channelType: 'test', threadId: 't1', memories: [] }

describe('archive skills', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExecSync.mockReturnValue('')
    mockExistsSync.mockReturnValue(true)
  })

  describe('archive_create', () => {
    const skill = getSkill('archive_create')!

    it('creates zip archive', async () => {
      const res = await skill.handler({ output: 'backup.zip', sources: ['dir1', 'file.txt'] }, ctx)
      expect(res.isError).toBe(false)
      expect(res.output).toContain('Archive created')
      expect(res.output).toContain('2.0 KB')
      expect(mockExecSync).toHaveBeenCalledWith(expect.stringContaining('zip -r'), expect.any(Object))
    })

    it('creates tar.gz archive', async () => {
      await skill.handler({ output: 'backup.tar.gz', sources: ['src'] }, ctx)
      expect(mockExecSync).toHaveBeenCalledWith(expect.stringContaining('tar czf'), expect.any(Object))
    })

    it('creates tar.bz2 archive', async () => {
      await skill.handler({ output: 'backup.tar.bz2', sources: ['src'] }, ctx)
      expect(mockExecSync).toHaveBeenCalledWith(expect.stringContaining('tar cjf'), expect.any(Object))
    })

    it('creates plain tar', async () => {
      await skill.handler({ output: 'backup.tar', sources: ['src'] }, ctx)
      expect(mockExecSync).toHaveBeenCalledWith(expect.stringContaining('tar cf'), expect.any(Object))
    })

    it('respects explicit format override', async () => {
      await skill.handler({ output: 'out.bin', sources: ['src'], format: 'tar.gz' }, ctx)
      expect(mockExecSync).toHaveBeenCalledWith(expect.stringContaining('tar czf'), expect.any(Object))
    })

    it('handles shell errors', async () => {
      mockExecSync.mockImplementation(() => { throw new Error('zip not found') })
      const res = await skill.handler({ output: 'backup.zip', sources: ['dir'] }, ctx)
      expect(res.isError).toBe(true)
      expect(res.output).toContain('zip not found')
    })
  })

  describe('archive_extract', () => {
    const skill = getSkill('archive_extract')!

    it('extracts zip', async () => {
      const res = await skill.handler({ archive: 'backup.zip', destination: '/tmp/out' }, ctx)
      expect(res.isError).toBe(false)
      expect(mockExecSync).toHaveBeenCalledWith(expect.stringContaining('unzip -o'), expect.any(Object))
    })

    it('extracts tar.gz', async () => {
      await skill.handler({ archive: 'backup.tar.gz' }, ctx)
      expect(mockExecSync).toHaveBeenCalledWith(expect.stringContaining('tar xzf'), expect.any(Object))
    })

    it('returns error if archive not found', async () => {
      mockExistsSync.mockReturnValue(false)
      const res = await skill.handler({ archive: 'missing.zip' }, ctx)
      expect(res.isError).toBe(true)
      expect(res.output).toContain('not found')
    })

    it('rejects unsupported format', async () => {
      const res = await skill.handler({ archive: 'file.rar' }, ctx)
      expect(res.isError).toBe(true)
      expect(res.output).toContain('Unsupported')
    })
  })

  describe('archive_list', () => {
    const skill = getSkill('archive_list')!

    it('lists zip contents', async () => {
      mockExecSync.mockReturnValue('file1.txt\nfile2.txt\ndir/')
      const res = await skill.handler({ archive: 'backup.zip' }, ctx)
      expect(res.isError).toBe(false)
      expect(res.metadata?.entries).toBe(3)
      expect(mockExecSync).toHaveBeenCalledWith(expect.stringContaining('unzip -l'), expect.any(Object))
    })

    it('lists tar.gz contents', async () => {
      mockExecSync.mockReturnValue('src/\nsrc/index.ts')
      await skill.handler({ archive: 'backup.tar.gz' }, ctx)
      expect(mockExecSync).toHaveBeenCalledWith(expect.stringContaining('tar tzf'), expect.any(Object))
    })

    it('returns error if archive not found', async () => {
      mockExistsSync.mockReturnValue(false)
      const res = await skill.handler({ archive: 'missing.tar' }, ctx)
      expect(res.isError).toBe(true)
    })
  })
})
