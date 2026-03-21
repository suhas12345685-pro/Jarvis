import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock playwright-extra and stealth
const mockEvaluate = vi.fn().mockResolvedValue('Page text content here')
const mockClick = vi.fn().mockResolvedValue(undefined)
const mockGoto = vi.fn().mockResolvedValue(undefined)
const mockWaitForSelector = vi.fn().mockResolvedValue(undefined)
const mockPageClose = vi.fn().mockResolvedValue(undefined)
const mockNewPage = vi.fn().mockResolvedValue({
  goto: mockGoto,
  click: mockClick,
  evaluate: mockEvaluate,
  waitForSelector: mockWaitForSelector,
  close: mockPageClose,
})
const mockNewContext = vi.fn().mockResolvedValue({ newPage: mockNewPage })
const mockBrowserClose = vi.fn().mockResolvedValue(undefined)

vi.mock('playwright-extra', () => ({
  chromium: {
    use: vi.fn(),
    launch: vi.fn().mockResolvedValue({
      newContext: mockNewContext,
      close: mockBrowserClose,
    }),
  },
}))
vi.mock('puppeteer-extra-plugin-stealth', () => ({ default: vi.fn().mockReturnValue({}) }))
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal() as any
  return { ...actual, mkdirSync: vi.fn() }
})

import { getSkill } from '../../../src/skills/index.js'
import '../../../src/skills/headlessBrowser.js'

const ctx: any = { userId: 'u1', channelType: 'test', threadId: 't1', memories: [] }

describe('headlessBrowser skills', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEvaluate.mockResolvedValue('Page text content here')
    mockClick.mockResolvedValue(undefined)
    mockGoto.mockResolvedValue(undefined)
  })

  describe('browser_navigate', () => {
    const skill = getSkill('browser_navigate')!

    it('navigates to URL and returns text', async () => {
      const res = await skill.handler({ url: 'https://example.com' }, ctx)
      expect(res.isError).toBe(false)
      expect(res.output).toBe('Page text content here')
      expect(mockGoto).toHaveBeenCalledWith('https://example.com', expect.any(Object))
      expect(mockPageClose).toHaveBeenCalled()
    })

    it('truncates long content', async () => {
      mockEvaluate.mockResolvedValue('x'.repeat(10000))
      const res = await skill.handler({ url: 'https://example.com' }, ctx)
      expect(res.output).toContain('[truncated]')
      expect(res.output.length).toBeLessThanOrEqual(8020)
    })

    it('waits for custom selector', async () => {
      await skill.handler({ url: 'https://example.com', waitForSelector: '.content' }, ctx)
      expect(mockWaitForSelector).toHaveBeenCalledWith('.content', expect.any(Object))
    })

    it('handles navigation errors', async () => {
      mockGoto.mockRejectedValue(new Error('net::ERR_CONNECTION_REFUSED'))
      const res = await skill.handler({ url: 'https://down.com' }, ctx)
      expect(res.isError).toBe(true)
      expect(res.output).toContain('Browser error')
    })
  })

  describe('browser_click', () => {
    const skill = getSkill('browser_click')!

    it('clicks element and returns page text', async () => {
      const res = await skill.handler({ url: 'https://example.com', selector: '#submit' }, ctx)
      expect(res.isError).toBe(false)
      expect(mockClick).toHaveBeenCalledWith('#submit', expect.any(Object))
    })

    it('handles click errors', async () => {
      mockClick.mockRejectedValue(new Error('Element not found'))
      const res = await skill.handler({ url: 'https://example.com', selector: '.missing' }, ctx)
      expect(res.isError).toBe(true)
    })
  })

  describe('browser_extract', () => {
    const skill = getSkill('browser_extract')!

    it('evaluates script and returns result', async () => {
      mockEvaluate.mockResolvedValue({ title: 'Test', links: 3 })
      const res = await skill.handler({ url: 'https://example.com', script: 'document.title' }, ctx)
      expect(res.isError).toBe(false)
      expect(JSON.parse(res.output)).toEqual({ title: 'Test', links: 3 })
    })

    it('returns string result directly', async () => {
      mockEvaluate.mockResolvedValue('direct string')
      const res = await skill.handler({ url: 'https://example.com', script: 'document.title' }, ctx)
      expect(res.output).toBe('direct string')
    })
  })
})
