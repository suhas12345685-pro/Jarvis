/**
 * Web Ghost — Invisible Headless Browser for Ghost Mode
 *
 * Uses Playwright in strict headless mode with stealth plugin.
 * Reuses the same singleton pattern and cookie-dismissal logic from
 * src/skills/headlessBrowser.ts.
 *
 * All operations are invisible — no browser windows, no popups.
 * Results are logged to the ghost log.
 */

import { ghostInfo, ghostError, ghostResult } from './ghostLog.js'

// Singleton browser context — reused across calls, cleaned up on exit
let _browser: import('playwright').Browser | null = null
let _context: import('playwright').BrowserContext | null = null

async function getBrowserContext(): Promise<import('playwright').BrowserContext> {
  if (_context) return _context

  const { chromium } = await import('playwright-extra')
  const stealth = (await import('puppeteer-extra-plugin-stealth')).default

  ;(chromium as unknown as { use: (plugin: unknown) => void }).use(stealth())

  _browser = await (chromium as unknown as typeof import('playwright').chromium).launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  })

  _context = await _browser.newContext({
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 },
  })

  return _context
}

// Cookie banner selectors — same as src/skills/headlessBrowser.ts
const COOKIE_SELECTORS = [
  'button[id*="accept"]', 'button[class*="accept"]', 'button[class*="cookie"]',
  '[aria-label*="Accept"]', '[data-testid*="cookie"] button',
  '#onetrust-accept-btn-handler', '.cc-btn.cc-dismiss',
]

async function dismissCookies(page: import('playwright').Page): Promise<void> {
  for (const sel of COOKIE_SELECTORS) {
    await page.click(sel, { timeout: 1000 }).catch(() => {})
  }
}

export interface ScrapeResult {
  url: string
  content: string
  title: string
  success: boolean
  error?: string
}

/**
 * Navigate to a URL invisibly, extract text content, and log the result.
 */
export async function scrape(url: string, waitForSelector?: string): Promise<ScrapeResult> {
  ghostInfo('Web scrape started', { url })

  try {
    const context = await getBrowserContext()
    const page = await context.newPage()

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await dismissCookies(page)

    if (waitForSelector) {
      await page.waitForSelector(waitForSelector, { timeout: 10_000 }).catch(() => {})
    }

    const title = await page.title()
    const text = await page.evaluate('document.body.innerText') as string
    await page.close()

    const truncated = text.length > 20_000 ? text.slice(0, 20_000) + '\n[content truncated]' : text

    ghostInfo('Web scrape completed', { url, title, contentLength: text.length })
    ghostResult(`web:${url}`, `Title: ${title}\n\n${truncated}`)

    return { url, content: truncated, title, success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    ghostError('Web scrape failed', { url, error: message })
    ghostResult(`web:${url}`, `FAILED: ${message}`)
    return { url, content: '', title: '', success: false, error: message }
  }
}

/**
 * Navigate to a URL and run custom JavaScript to extract data.
 */
export async function extractWithScript(url: string, script: string): Promise<ScrapeResult> {
  ghostInfo('Web extract started', { url, scriptLength: script.length })

  try {
    const context = await getBrowserContext()
    const page = await context.newPage()

    await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 })
    await dismissCookies(page)

    const title = await page.title()
    const result = await page.evaluate(script)
    await page.close()

    const content = typeof result === 'string' ? result : JSON.stringify(result, null, 2)
    const truncated = content.length > 20_000 ? content.slice(0, 20_000) + '\n[truncated]' : content

    ghostInfo('Web extract completed', { url, title })
    ghostResult(`extract:${url}`, `Title: ${title}\nScript result:\n${truncated}`)

    return { url, content: truncated, title, success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    ghostError('Web extract failed', { url, error: message })
    ghostResult(`extract:${url}`, `FAILED: ${message}`)
    return { url, content: '', title: '', success: false, error: message }
  }
}

/**
 * Take an invisible screenshot of a URL and save to a file.
 */
export async function screenshot(url: string, outputPath: string): Promise<{ success: boolean; path?: string; error?: string }> {
  ghostInfo('Screenshot started', { url, outputPath })

  try {
    const context = await getBrowserContext()
    const page = await context.newPage()

    await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 })
    await dismissCookies(page)

    await page.screenshot({ path: outputPath, fullPage: true })
    await page.close()

    ghostInfo('Screenshot saved', { url, outputPath })
    ghostResult(`screenshot:${url}`, `Saved to: ${outputPath}`)

    return { success: true, path: outputPath }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    ghostError('Screenshot failed', { url, error: message })
    return { success: false, error: message }
  }
}

/**
 * Gracefully close the browser. Call this when the worker is done.
 */
export async function closeBrowser(): Promise<void> {
  try {
    if (_context) { await _context.close(); _context = null }
    if (_browser) { await _browser.close(); _browser = null }
  } catch {
    // Best-effort cleanup
  }
}

// Cleanup on process exit
process.on('exit', () => {
  _browser?.close().catch(() => {})
})
