import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock child_process
const { mockExecSync } = vi.hoisted(() => ({ mockExecSync: vi.fn() }))
vi.mock('child_process', () => ({ execSync: mockExecSync }))

import { getSkill } from '../../../src/skills/index.js'
import '../../../src/skills/gitOps.js'

const ctx: any = { userId: 'u1', channelType: 'test', threadId: 't1', memories: [] }

describe('gitOps skills', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExecSync.mockReturnValue('mock output')
  })

  describe('git_status', () => {
    const skill = getSkill('git_status')!

    it('shows branch and status', async () => {
      mockExecSync
        .mockReturnValueOnce(' M file.ts\n')  // status --short
        .mockReturnValueOnce('main\n')         // branch --show-current
      const res = await skill.handler({}, ctx)
      expect(res.isError).toBe(false)
      expect(res.output).toContain('Branch: main')
      expect(res.output).toContain('M file.ts')
    })

    it('shows clean tree message', async () => {
      mockExecSync
        .mockReturnValueOnce('')       // no changes
        .mockReturnValueOnce('main')
      const res = await skill.handler({}, ctx)
      expect(res.output).toContain('Working tree clean')
    })

    it('uses custom path', async () => {
      mockExecSync.mockReturnValueOnce('').mockReturnValueOnce('dev')
      await skill.handler({ path: '/tmp/repo' }, ctx)
      expect(mockExecSync).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ cwd: '/tmp/repo' }))
    })

    it('handles git errors', async () => {
      mockExecSync.mockImplementation(() => { throw new Error('not a git repo') })
      const res = await skill.handler({}, ctx)
      expect(res.isError).toBe(true)
      expect(res.output).toContain('not a git repo')
    })
  })

  describe('git_log', () => {
    const skill = getSkill('git_log')!

    it('shows recent commits', async () => {
      mockExecSync.mockReturnValue('abc123 Initial commit')
      const res = await skill.handler({}, ctx)
      expect(res.isError).toBe(false)
      expect(res.output).toContain('abc123')
    })

    it('caps count at 50', async () => {
      mockExecSync.mockReturnValue('log output')
      await skill.handler({ count: 100 }, ctx)
      expect(mockExecSync).toHaveBeenCalledWith(expect.stringContaining('-50'), expect.any(Object))
    })
  })

  describe('git_diff', () => {
    const skill = getSkill('git_diff')!

    it('shows unstaged diff', async () => {
      mockExecSync.mockReturnValue('diff --git a/f')
      const res = await skill.handler({}, ctx)
      expect(res.isError).toBe(false)
      expect(res.output).toContain('diff')
    })

    it('shows staged diff', async () => {
      mockExecSync.mockReturnValue('staged changes')
      await skill.handler({ staged: true }, ctx)
      expect(mockExecSync).toHaveBeenCalledWith(expect.stringContaining('--staged'), expect.any(Object))
    })

    it('reports no changes', async () => {
      mockExecSync.mockReturnValue('')
      const res = await skill.handler({}, ctx)
      expect(res.output).toBe('No changes')
    })

    it('truncates large diffs to 8000 chars', async () => {
      mockExecSync.mockReturnValue('x'.repeat(10000))
      const res = await skill.handler({}, ctx)
      expect(res.output.length).toBe(8000)
    })
  })

  describe('git_clone', () => {
    const skill = getSkill('git_clone')!

    it('clones a repository', async () => {
      mockExecSync.mockReturnValue('')
      const res = await skill.handler({ url: 'https://github.com/user/repo.git' }, ctx)
      expect(res.isError).toBe(false)
      expect(res.output).toContain('cloned')
    })

    it('rejects invalid URLs', async () => {
      const res = await skill.handler({ url: 'not-a-url' }, ctx)
      expect(res.isError).toBe(true)
      expect(res.output).toContain('Invalid')
    })

    it('allows custom directory name', async () => {
      mockExecSync.mockReturnValue('')
      await skill.handler({ url: 'https://github.com/user/repo.git', name: 'myrepo' }, ctx)
      expect(mockExecSync).toHaveBeenCalledWith(expect.stringContaining('myrepo'), expect.any(Object))
    })
  })
})
