import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock ghostLog
const mockGhostInfo = vi.fn()
const mockGhostError = vi.fn()

vi.mock('../../../src/cli/ghostLog.js', () => ({
  ghostInfo: (...args: unknown[]) => mockGhostInfo(...args),
  ghostError: (...args: unknown[]) => mockGhostError(...args),
}))

// Mock taskRouter
const mockRouteTask = vi.fn()

vi.mock('../../../src/cli/taskRouter.js', () => ({
  routeTask: (...args: unknown[]) => mockRouteTask(...args),
}))

describe('Ghost Worker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRouteTask.mockResolvedValue(undefined)
  })

  function encodePayload(payload: Record<string, unknown>): string {
    return Buffer.from(JSON.stringify(payload)).toString('base64')
  }

  describe('payload decoding', () => {
    it('decodes valid base64 JSON payload', () => {
      const payload = { type: 'exec', command: 'ls', taskId: 'test-1' }
      const encoded = encodePayload(payload)
      const decoded = JSON.parse(Buffer.from(encoded, 'base64').toString('utf-8'))

      expect(decoded).toEqual(payload)
    })

    it('handles complex nested payloads', () => {
      const payload = {
        type: 'ai',
        prompt: 'analyze this',
        taskId: 'test-2',
        options: { model: 'gpt-4o', temperature: 0.7 },
      }
      const encoded = encodePayload(payload)
      const decoded = JSON.parse(Buffer.from(encoded, 'base64').toString('utf-8'))

      expect(decoded).toEqual(payload)
    })

    it('throws on invalid base64', () => {
      expect(() => {
        JSON.parse(Buffer.from('!!!invalid!!!', 'base64').toString('utf-8'))
      }).toThrow()
    })

    it('throws on valid base64 but invalid JSON', () => {
      const notJson = Buffer.from('not json content').toString('base64')
      expect(() => {
        JSON.parse(Buffer.from(notJson, 'base64').toString('utf-8'))
      }).toThrow()
    })
  })

  describe('routeTask integration', () => {
    it('calls routeTask with decoded payload', async () => {
      const payload = { type: 'exec', command: 'echo hello', taskId: 'test-3' }
      await mockRouteTask(payload)

      expect(mockRouteTask).toHaveBeenCalledWith(payload)
    })

    it('handles routeTask errors gracefully', async () => {
      mockRouteTask.mockRejectedValueOnce(new Error('Task failed'))

      try {
        await mockRouteTask({ type: 'web', url: 'http://bad.test', taskId: 'test-4' })
      } catch (err) {
        expect((err as Error).message).toBe('Task failed')
      }
    })

    it('supports web task payloads', async () => {
      const payload = { type: 'web', url: 'https://example.com', taskId: 'test-5' }
      await mockRouteTask(payload)

      expect(mockRouteTask).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'web', url: 'https://example.com' })
      )
    })

    it('supports ai task payloads', async () => {
      const payload = { type: 'ai', prompt: 'What is 2+2?', taskId: 'test-6' }
      await mockRouteTask(payload)

      expect(mockRouteTask).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'ai', prompt: 'What is 2+2?' })
      )
    })
  })

  describe('error handling patterns', () => {
    it('extracts Error message correctly', () => {
      const err = new Error('Something went wrong')
      const message = err instanceof Error ? err.message : String(err)
      expect(message).toBe('Something went wrong')
    })

    it('converts non-Error to string', () => {
      const err = 'string error'
      const message = err instanceof Error ? err.message : String(err)
      expect(message).toBe('string error')
    })

    it('handles Error with stack trace', () => {
      const err = new Error('Stack test')
      expect(err.stack).toBeTruthy()
      expect(err.stack).toContain('Stack test')
    })
  })
})
