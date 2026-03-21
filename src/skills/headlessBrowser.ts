import { registerSkill } from './index.js'
import type { AgentContext, SkillResult } from '../types/index.js'
import { getLogger } from '../logger.js'
import { homedir } from 'os'
import { resolve } from 'path'
import { mkdirSync } from 'fs'

const COOKIES_DIR = resolve(homedir(), '.jarvis', 'cookies')
mkdirSync(COOKIES_DIR, { recursive: true })

// Singleton browser context (reused across calls for performance)
let _browser: import('playwright').Browser | null = null
let _context: import('playwright').BrowserContext | null = null

async function getBrowserContext(): Promise<import('playwright').BrowserContext> {
  if (_context) return _context

  const { chromium } = await import('playwright-extra')
  const stealth = (await import('puppeteer-extra-plugin-stealth')).default

  ;(chromium as unknown as { use: (plugin: unknown) => void }).use(stealth())

  _browser = await (chromium as unknown as typeof import('playwright').chromium).launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--hide-scrollbars',
      '--disable-gpu',
      '--disable-software-rasterizer',
      '--disable-dev-shm-usage',
    ],
  })

  _context = await _browser.newContext({
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 },
  })

  return _context
}

registerSkill({
  name: 'browser_navigate',
  description: 'Navigate to a URL and return the page text content. Handles cookie consent banners automatically.',
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'URL to navigate to' },
      waitForSelector: { type: 'string', description: 'Optional CSS selector to wait for before extracting content' },
    },
    required: ['url'],
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    try {
      const context = await getBrowserContext()
      const page = await context.newPage()

      await page.goto(String(input.url), { waitUntil: 'domcontentloaded', timeout: 30_000 })

      // Auto-dismiss cookie banners
      const cookieSelectors = [
        'button[id*="accept"]', 'button[class*="accept"]', 'button[class*="cookie"]',
        '[aria-label*="Accept"]', '[data-testid*="cookie"] button',
        '#onetrust-accept-btn-handler', '.cc-btn.cc-dismiss',
      ]
      for (const sel of cookieSelectors) {
        await page.click(sel, { timeout: 1000 }).catch(() => {})
      }

      if (input.waitForSelector) {
        await page.waitForSelector(String(input.waitForSelector), { timeout: 10_000 }).catch(() => {})
      }

      const text = await page.evaluate('document.body.innerText') as string
      await page.close()

      const truncated = text.length > 8000 ? text.slice(0, 8000) + '\n[truncated]' : text
      return { output: truncated, isError: false }
    } catch (err) {
      return { output: `Browser error: ${(err as Error).message}`, isError: true }
    }
  },
})

registerSkill({
  name: 'browser_click',
  description: 'Click an element on the current page by CSS selector.',
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'URL to navigate to first' },
      selector: { type: 'string', description: 'CSS selector of element to click' },
    },
    required: ['url', 'selector'],
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    try {
      const context = await getBrowserContext()
      const page = await context.newPage()
      await page.goto(String(input.url), { waitUntil: 'domcontentloaded', timeout: 30_000 })
      await page.click(String(input.selector), { timeout: 10_000 })
      const text = await page.evaluate('document.body.innerText') as string
      await page.close()
      return { output: text.slice(0, 8000), isError: false }
    } catch (err) {
      return { output: `Browser click error: ${(err as Error).message}`, isError: true }
    }
  },
})

registerSkill({
  name: 'browser_extract',
  description: 'Run custom JavaScript in the browser page and return the result. Use for extracting data from complex SPAs.',
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'URL to navigate to' },
      script: { type: 'string', description: 'JavaScript expression to evaluate — should return a string or JSON-serializable value' },
    },
    required: ['url', 'script'],
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    try {
      const context = await getBrowserContext()
      const page = await context.newPage()
      await page.goto(String(input.url), { waitUntil: 'networkidle', timeout: 30_000 })
      const result = await page.evaluate(String(input.script))
      await page.close()
      return {
        output: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
        isError: false,
      }
    } catch (err) {
      return { output: `Browser extract error: ${(err as Error).message}`, isError: true }
    }
  },
})

// Cleanup on process exit
process.on('exit', () => {
  _browser?.close().catch(() => {})
})
