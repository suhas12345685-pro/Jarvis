import { describe, it, expect, vi } from 'vitest'
import type { GhostPayload } from '../../../src/cli/taskRouter.js'

// Mock ghost log to prevent file writes during tests
vi.mock('../../../src/cli/ghostLog.js', () => ({
  ghostInfo: vi.fn(),
  ghostError: vi.fn(),
  ghostResult: vi.fn(),
  readRecent: vi.fn(() => ''),
  readRecentResults: vi.fn(() => ''),
  GHOST_LOG_PATH: '/tmp/test-ghost.log',
}))

// Mock webGhost
vi.mock('../../../src/cli/webGhost.js', () => ({
  scrape: vi.fn(async () => 'scraped content'),
  extractWithScript: vi.fn(async () => 'extracted content'),
  screenshot: vi.fn(async () => {}),
  closeBrowser: vi.fn(async () => {}),
}))

// Mock osExec
vi.mock('../../../src/cli/osExec.js', () => ({
  run: vi.fn(async (cmd: string) => ({
    stdout: `output of ${cmd}`,
    stderr: '',
    exitCode: 0,
    blocked: false,
  })),
}))

describe('taskRouter', () => {
  let routeTask: typeof import('../../../src/cli/taskRouter.js').routeTask
  let ghostInfo: ReturnType<typeof vi.fn>
  let ghostError: ReturnType<typeof vi.fn>

  it('routes exec tasks to osExec', async () => {
    const mod = await import('../../../src/cli/taskRouter.js')
    routeTask = mod.routeTask
    const ghostLog = await import('../../../src/cli/ghostLog.js')
    ghostInfo = ghostLog.ghostInfo as ReturnType<typeof vi.fn>
    ghostError = ghostLog.ghostError as ReturnType<typeof vi.fn>

    const { run } = await import('../../../src/cli/osExec.js')

    const payload: GhostPayload = {
      type: 'exec',
      command: 'echo hello',
      taskId: 'test-exec-1',
      timestamp: new Date().toISOString(),
    }

    await routeTask(payload)
    expect(run).toHaveBeenCalledWith('echo hello', undefined)
  })

  it('routes web tasks to webGhost.scrape', async () => {
    const { scrape, closeBrowser } = await import('../../../src/cli/webGhost.js')

    const payload: GhostPayload = {
      type: 'web',
      url: 'https://example.com',
      taskId: 'test-web-1',
      timestamp: new Date().toISOString(),
    }

    await routeTask(payload)
    expect(scrape).toHaveBeenCalledWith('https://example.com', undefined)
    expect(closeBrowser).toHaveBeenCalled()
  })

  it('routes web screenshot tasks', async () => {
    const { screenshot, closeBrowser } = await import('../../../src/cli/webGhost.js')

    const payload: GhostPayload = {
      type: 'web',
      url: 'https://example.com',
      screenshotPath: '/tmp/shot.png',
      taskId: 'test-web-2',
      timestamp: new Date().toISOString(),
    }

    await routeTask(payload)
    expect(screenshot).toHaveBeenCalledWith('https://example.com', '/tmp/shot.png')
    expect(closeBrowser).toHaveBeenCalled()
  })

  it('logs error for missing exec command', async () => {
    const payload: GhostPayload = {
      type: 'exec',
      taskId: 'test-no-cmd',
      timestamp: new Date().toISOString(),
    }

    await routeTask(payload)
    expect(ghostError).toHaveBeenCalledWith('Exec task missing command')
  })

  it('logs error for missing web URL', async () => {
    const payload: GhostPayload = {
      type: 'web',
      taskId: 'test-no-url',
      timestamp: new Date().toISOString(),
    }

    await routeTask(payload)
    expect(ghostError).toHaveBeenCalledWith('Web task missing URL')
  })

  it('handles unknown task type gracefully', async () => {
    const payload: GhostPayload = {
      type: 'unknown' as 'web',
      taskId: 'test-unknown',
      timestamp: new Date().toISOString(),
    }

    await routeTask(payload)
    expect(ghostError).toHaveBeenCalledWith(expect.stringContaining('Unknown task type'))
  })
})
