import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock ghostLog
vi.mock('../../../src/cli/ghostLog.js', () => ({
  ghostInfo: vi.fn(),
  ghostError: vi.fn(),
  ghostResult: vi.fn(),
}))

// Mock Playwright with controllable page behavior
const mockPage = {
  goto: vi.fn().mockResolvedValue(undefined),
  title: vi.fn().mockResolvedValue('Test Page'),
  evaluate: vi.fn().mockResolvedValue('Page text content'),
  click: vi.fn().mockRejectedValue(new Error('not found')), // cookie banners not found
  waitForSelector: vi.fn().mockResolvedValue(undefined),
  screenshot: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
}

const mockContext = {
  newPage: vi.fn().mockResolvedValue(mockPage),
  close: vi.fn().mockResolvedValue(undefined),
}

const mockBrowser = {
  newContext: vi.fn().mockResolvedValue(mockContext),
  close: vi.fn().mockResolvedValue(undefined),
}

vi.mock('playwright-extra', () => ({
  chromium: {
    use: vi.fn(),
    launch: vi.fn().mockResolvedValue(mockBrowser),
  },
}))

vi.mock('puppeteer-extra-plugin-stealth', () => ({
  default: vi.fn(() => ({})),
}))

import { scrape, extractWithScript, screenshot, closeBrowser } from '../../../src/cli/webGhost.js'
import { ghostInfo, ghostError, ghostResult } from '../../../src/cli/ghostLog.js'

describe('webGhost', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset page mocks to defaults
    mockPage.goto.mockResolvedValue(undefined)
    mockPage.title.mockResolvedValue('Test Page')
    mockPage.evaluate.mockResolvedValue('Page text content')
    mockPage.click.mockRejectedValue(new Error('not found'))
    mockPage.screenshot.mockResolvedValue(undefined)
  })

  describe('scrape', () => {
    it('returns scraped content with title', async () => {
      const result = await scrape('https://example.com')

      expect(result.success).toBe(true)
      expect(result.url).toBe('https://example.com')
      expect(result.title).toBe('Test Page')
      expect(result.content).toBe('Page text content')
      expect(mockPage.goto).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({ waitUntil: 'domcontentloaded' })
      )
      expect(mockPage.close).toHaveBeenCalled()
    })

    it('waits for custom selector when provided', async () => {
      await scrape('https://example.com', '#content')

      expect(mockPage.waitForSelector).toHaveBeenCalledWith('#content', { timeout: 10_000 })
    })

    it('truncates content over 20KB', async () => {
      const longContent = 'x'.repeat(25_000)
      mockPage.evaluate.mockResolvedValueOnce(longContent)

      const result = await scrape('https://example.com')

      expect(result.content.length).toBeLessThanOrEqual(20_000 + 20) // truncation marker
      expect(result.content).toContain('[content truncated]')
    })

    it('logs scrape start and completion', async () => {
      await scrape('https://example.com')

      expect(ghostInfo).toHaveBeenCalledWith('Web scrape started', expect.objectContaining({ url: 'https://example.com' }))
      expect(ghostInfo).toHaveBeenCalledWith('Web scrape completed', expect.objectContaining({ url: 'https://example.com' }))
      expect(ghostResult).toHaveBeenCalled()
    })

    it('returns failure on navigation error', async () => {
      mockPage.goto.mockRejectedValueOnce(new Error('net::ERR_CONNECTION_REFUSED'))

      const result = await scrape('https://bad-url.test')

      expect(result.success).toBe(false)
      expect(result.error).toContain('ERR_CONNECTION_REFUSED')
      expect(result.content).toBe('')
      expect(ghostError).toHaveBeenCalled()
    })

    it('attempts cookie dismissal on each selector', async () => {
      await scrape('https://example.com')

      // Should attempt to click multiple cookie selectors
      expect(mockPage.click).toHaveBeenCalled()
    })
  })

  describe('extractWithScript', () => {
    it('runs custom script and returns result', async () => {
      mockPage.evaluate.mockResolvedValueOnce({ items: [1, 2, 3] })

      const result = await extractWithScript('https://example.com', 'document.querySelectorAll("li")')

      expect(result.success).toBe(true)
      expect(result.content).toContain('"items"')
      expect(result.title).toBe('Test Page')
    })

    it('handles string result from script', async () => {
      mockPage.evaluate.mockResolvedValueOnce('extracted text')

      const result = await extractWithScript('https://example.com', 'document.body.innerText')

      expect(result.content).toBe('extracted text')
    })

    it('returns failure when script throws', async () => {
      mockPage.evaluate.mockRejectedValueOnce(new Error('Script error'))

      const result = await extractWithScript('https://example.com', 'bad script')

      expect(result.success).toBe(false)
      expect(result.error).toContain('Script error')
    })

    it('truncates long script results', async () => {
      mockPage.evaluate.mockResolvedValueOnce('y'.repeat(25_000))

      const result = await extractWithScript('https://example.com', 'long output')

      expect(result.content).toContain('[truncated]')
      expect(result.content.length).toBeLessThanOrEqual(20_020)
    })
  })

  describe('screenshot', () => {
    it('saves screenshot to specified path', async () => {
      const result = await screenshot('https://example.com', '/tmp/shot.png')

      expect(result.success).toBe(true)
      expect(result.path).toBe('/tmp/shot.png')
      expect(mockPage.screenshot).toHaveBeenCalledWith({ path: '/tmp/shot.png', fullPage: true })
      expect(mockPage.close).toHaveBeenCalled()
    })

    it('returns failure on screenshot error', async () => {
      mockPage.screenshot.mockRejectedValueOnce(new Error('Write permission denied'))

      const result = await screenshot('https://example.com', '/root/shot.png')

      expect(result.success).toBe(false)
      expect(result.error).toContain('Write permission denied')
    })

    it('logs screenshot start and result', async () => {
      await screenshot('https://example.com', '/tmp/shot.png')

      expect(ghostInfo).toHaveBeenCalledWith('Screenshot started', expect.objectContaining({ url: 'https://example.com' }))
      expect(ghostInfo).toHaveBeenCalledWith('Screenshot saved', expect.objectContaining({ outputPath: '/tmp/shot.png' }))
    })
  })

  describe('closeBrowser', () => {
    it('cleans up browser resources without error', async () => {
      await closeBrowser()
      // Should not throw
    })
  })
})
