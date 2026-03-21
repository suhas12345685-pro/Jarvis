import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockExecSync } = vi.hoisted(() => ({ mockExecSync: vi.fn() }))
vi.mock('child_process', () => ({ execSync: mockExecSync }))

import { getSkill } from '../../../src/skills/index.js'
import '../../../src/skills/docker.js'

const ctx: any = { userId: 'u1', channelType: 'test', threadId: 't1', memories: [] }

describe('docker skills', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExecSync.mockReturnValue('mock output')
  })

  describe('docker_ps', () => {
    const skill = getSkill('docker_ps')!

    it('lists running containers', async () => {
      mockExecSync.mockReturnValue('CONTAINER ID  NAMES  IMAGE\nabc123  myapp  nginx')
      const res = await skill.handler({}, ctx)
      expect(res.isError).toBe(false)
      expect(res.output).toContain('abc123')
    })

    it('uses -a flag when all is true', async () => {
      mockExecSync.mockReturnValue('')
      const res = await skill.handler({ all: true }, ctx)
      expect(mockExecSync).toHaveBeenCalledWith(expect.stringContaining('-a'), expect.any(Object))
      expect(res.output).toBe('No containers found')
    })

    it('handles docker errors', async () => {
      mockExecSync.mockImplementation(() => { throw new Error('Cannot connect to Docker') })
      const res = await skill.handler({}, ctx)
      expect(res.isError).toBe(true)
      expect(res.output).toContain('Docker error')
    })
  })

  describe('docker_logs', () => {
    const skill = getSkill('docker_logs')!

    it('gets container logs', async () => {
      mockExecSync.mockReturnValue('2024-01-01 Server started')
      const res = await skill.handler({ container: 'myapp' }, ctx)
      expect(res.isError).toBe(false)
      expect(res.output).toContain('Server started')
    })

    it('uses tail and since flags', async () => {
      mockExecSync.mockReturnValue('log line')
      await skill.handler({ container: 'myapp', tail: 50, since: '10m' }, ctx)
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('--tail 50'),
        expect.any(Object)
      )
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('--since 10m'),
        expect.any(Object)
      )
    })

    it('sanitizes container name', async () => {
      mockExecSync.mockReturnValue('')
      await skill.handler({ container: 'myapp; rm -rf /' }, ctx)
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('myapp'),
        expect.any(Object)
      )
      expect(mockExecSync).not.toHaveBeenCalledWith(
        expect.stringContaining(';'),
        expect.any(Object)
      )
    })
  })

  describe('docker_start', () => {
    const skill = getSkill('docker_start')!

    it('starts a container', async () => {
      mockExecSync.mockReturnValue('myapp')
      const res = await skill.handler({ container: 'myapp' }, ctx)
      expect(res.isError).toBe(false)
      expect(res.output).toContain('Started container: myapp')
    })
  })

  describe('docker_stop', () => {
    const skill = getSkill('docker_stop')!

    it('stops a container with default timeout', async () => {
      mockExecSync.mockReturnValue('myapp')
      const res = await skill.handler({ container: 'myapp' }, ctx)
      expect(res.isError).toBe(false)
      expect(mockExecSync).toHaveBeenCalledWith(expect.stringContaining('-t 10'), expect.any(Object))
    })

    it('uses custom timeout', async () => {
      mockExecSync.mockReturnValue('myapp')
      await skill.handler({ container: 'myapp', timeout: 30 }, ctx)
      expect(mockExecSync).toHaveBeenCalledWith(expect.stringContaining('-t 30'), expect.any(Object))
    })
  })

  describe('docker_exec', () => {
    const skill = getSkill('docker_exec')!

    it('executes command in container', async () => {
      mockExecSync.mockReturnValue('hello')
      const res = await skill.handler({ container: 'myapp', command: 'echo hello' }, ctx)
      expect(res.isError).toBe(false)
      expect(res.output).toBe('hello')
    })

    it('uses workdir flag', async () => {
      mockExecSync.mockReturnValue('')
      await skill.handler({ container: 'myapp', command: 'ls', workdir: '/app' }, ctx)
      expect(mockExecSync).toHaveBeenCalledWith(expect.stringContaining("-w '/app'"), expect.any(Object))
    })

    it('returns (no output) for empty result', async () => {
      mockExecSync.mockReturnValue('')
      const res = await skill.handler({ container: 'myapp', command: 'true' }, ctx)
      expect(res.output).toBe('(no output)')
    })
  })

  describe('docker_images', () => {
    const skill = getSkill('docker_images')!

    it('lists all images', async () => {
      mockExecSync.mockReturnValue('nginx  latest  abc123  100MB  2 weeks ago')
      const res = await skill.handler({}, ctx)
      expect(res.isError).toBe(false)
      expect(res.output).toContain('nginx')
    })

    it('applies filter', async () => {
      mockExecSync.mockReturnValue('nginx  latest')
      await skill.handler({ filter: 'nginx' }, ctx)
      expect(mockExecSync).toHaveBeenCalledWith(expect.stringContaining("reference='nginx'"), expect.any(Object))
    })
  })
})
