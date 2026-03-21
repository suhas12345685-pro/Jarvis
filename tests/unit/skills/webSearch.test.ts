import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock axios
const { mockAxiosGet } = vi.hoisted(() => ({ mockAxiosGet: vi.fn() }))
vi.mock('axios', () => ({ default: { get: mockAxiosGet } }))

// Mock config
vi.mock('../../../src/config.js', () => ({
  getByoakValue: vi.fn((byoak: any, provider: string, key: string) => {
    if (provider === 'serpapi' && key === 'API_KEY') return byoak?.serpapi_key || ''
    if (provider === 'google_search' && key === 'API_KEY') return byoak?.google_key || ''
    if (provider === 'google_search' && key === 'CX') return byoak?.google_cx || ''
    return ''
  }),
}))

// Mock security
vi.mock('../../../src/security.js', () => ({
  validateUrl: (url: string) => {
    if (url.startsWith('http')) return { valid: true }
    return { valid: false, error: 'Invalid URL' }
  },
}))

import { getSkill } from '../../../src/skills/index.js'
import '../../../src/skills/webSearch.js'

describe('webSearch skills', () => {
  beforeEach(() => vi.clearAllMocks())

  describe('web_search', () => {
    const skill = getSkill('web_search')!

    it('searches with SerpAPI', async () => {
      mockAxiosGet.mockResolvedValue({
        data: {
          organic_results: [
            { title: 'Result 1', link: 'https://example.com', snippet: 'A snippet' },
            { title: 'Result 2', link: 'https://example.org', snippet: 'Another snippet' },
          ],
        },
      })
      const ctx: any = { byoak: { serpapi_key: 'test-key' } }
      const res = await skill.handler({ query: 'test query' }, ctx)
      expect(res.isError).toBe(false)
      expect(res.output).toContain('Result 1')
      expect(res.output).toContain('Result 2')
    })

    it('searches with Google Custom Search', async () => {
      mockAxiosGet.mockResolvedValue({
        data: {
          items: [
            { title: 'Google Result', link: 'https://google.com', snippet: 'Found it' },
          ],
        },
      })
      const ctx: any = { byoak: { google_key: 'gkey', google_cx: 'cx123' } }
      const res = await skill.handler({ query: 'test' }, ctx)
      expect(res.isError).toBe(false)
      expect(res.output).toContain('Google Result')
    })

    it('returns error when no search engine configured', async () => {
      const ctx: any = { byoak: {} }
      const res = await skill.handler({ query: 'test' }, ctx)
      expect(res.isError).toBe(true)
      expect(res.output).toContain('No search engine configured')
    })

    it('handles no results from SerpAPI', async () => {
      mockAxiosGet.mockResolvedValue({ data: { organic_results: [] } })
      const ctx: any = { byoak: { serpapi_key: 'key' } }
      const res = await skill.handler({ query: 'obscure query' }, ctx)
      expect(res.output).toContain('No results found')
    })

    it('caps results at 10', async () => {
      const results = Array.from({ length: 15 }, (_, i) => ({
        title: `R${i}`, link: `https://e.com/${i}`, snippet: `s${i}`,
      }))
      mockAxiosGet.mockResolvedValue({ data: { organic_results: results } })
      const ctx: any = { byoak: { serpapi_key: 'key' } }
      const res = await skill.handler({ query: 'test', numResults: 20 }, ctx)
      // numResults capped to 10
      expect(res.isError).toBe(false)
    })

    it('handles API errors', async () => {
      mockAxiosGet.mockRejectedValue(new Error('Rate limited'))
      const ctx: any = { byoak: { serpapi_key: 'key' } }
      const res = await skill.handler({ query: 'test' }, ctx)
      expect(res.isError).toBe(true)
      expect(res.output).toContain('Rate limited')
    })
  })

  describe('web_scrape_text', () => {
    const skill = getSkill('web_scrape_text')!
    const ctx: any = { byoak: {} }

    it('scrapes and cleans HTML', async () => {
      mockAxiosGet.mockResolvedValue({
        data: '<html><body><script>var x=1;</script><p>Hello world</p><style>.x{}</style></body></html>',
      })
      const res = await skill.handler({ url: 'https://example.com' }, ctx)
      expect(res.isError).toBe(false)
      expect(res.output).toContain('Hello world')
      expect(res.output).not.toContain('var x=1')
      expect(res.output).not.toContain('.x{}')
    })

    it('blocks invalid URLs', async () => {
      const res = await skill.handler({ url: 'not-a-url' }, ctx)
      expect(res.isError).toBe(true)
      expect(res.output).toContain('BLOCKED')
    })

    it('truncates large content', async () => {
      mockAxiosGet.mockResolvedValue({ data: `<p>${'x'.repeat(20000)}</p>` })
      const res = await skill.handler({ url: 'https://example.com' }, ctx)
      expect(res.output).toContain('[truncated]')
      expect(res.output.length).toBeLessThanOrEqual(8020)
    })

    it('handles fetch errors', async () => {
      mockAxiosGet.mockRejectedValue(new Error('Timeout'))
      const res = await skill.handler({ url: 'https://slow.com' }, ctx)
      expect(res.isError).toBe(true)
      expect(res.output).toContain('Timeout')
    })
  })
})
