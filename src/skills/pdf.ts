/**
 * PDF skills — extract text, generate PDFs from HTML, get PDF info.
 */
import { registerSkill } from './index.js'
import type { AgentContext, SkillResult } from '../types/index.js'
import { readFileSync, writeFileSync, statSync } from 'fs'

registerSkill({
  name: 'pdf_extract',
  description: 'Extract text content from a PDF file.',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Path to the PDF file' },
      pages: { type: 'string', description: 'Page range to extract (e.g., "1-5", "1,3,5"). Default: all pages' },
    },
    required: ['file_path'],
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    try {
      const filePath = String(input.file_path)
      const pdfParse = (await import('pdf-parse')).default
      const buffer = readFileSync(filePath)
      const data = await pdfParse(buffer)

      let text = data.text
      if (input.pages) {
        const pageTexts = text.split(/\f/) // Form feed splits pages in pdf-parse
        const pages = parsePageRange(String(input.pages), pageTexts.length)
        text = pages.map(p => pageTexts[p - 1] || '').join('\n--- Page Break ---\n')
      }

      // Truncate if massive
      if (text.length > 100000) {
        text = text.slice(0, 100000) + '\n... (truncated, use pages parameter to read specific sections)'
      }

      return {
        output: text || '(no text extracted — PDF may be image-based)',
        isError: false,
        metadata: { pages: data.numpages, info: data.info },
      }
    } catch (err) {
      return { output: `PDF extract error: ${(err as Error).message}`, isError: true }
    }
  },
})

registerSkill({
  name: 'pdf_generate',
  description: 'Generate a PDF from HTML content and save to a file.',
  inputSchema: {
    type: 'object',
    properties: {
      html: { type: 'string', description: 'HTML content to convert to PDF' },
      output_path: { type: 'string', description: 'Where to save the PDF file' },
      title: { type: 'string', description: 'Document title' },
      landscape: { type: 'boolean', description: 'Landscape orientation (default: false)' },
      margin: { type: 'string', description: 'Page margin (e.g., "1cm", "0.5in"). Default: 1cm' },
    },
    required: ['html', 'output_path'],
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    try {
      const html = String(input.html)
      const outputPath = String(input.output_path)
      const title = String(input.title || 'Document')
      const landscape = Boolean(input.landscape)
      const margin = String(input.margin || '1cm')

      // Use playwright (same dependency as headlessBrowser skill)
      const { chromium } = await import('playwright')

      const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      })

      try {
        const page = await browser.newPage()
        const fullHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${html}</body></html>`
        await page.setContent(fullHtml, { waitUntil: 'networkidle' })

        await page.pdf({
          path: outputPath,
          format: 'A4',
          landscape,
          margin: { top: margin, right: margin, bottom: margin, left: margin },
          printBackground: true,
        })

        const stats = statSync(outputPath)
        return {
          output: `PDF generated: ${outputPath} (${(stats.size / 1024).toFixed(1)} KB)`,
          isError: false,
          metadata: { path: outputPath, size: stats.size },
        }
      } finally {
        await browser.close()
      }
    } catch (err) {
      return { output: `PDF generate error: ${(err as Error).message}`, isError: true }
    }
  },
})

registerSkill({
  name: 'pdf_info',
  description: 'Get metadata and page count of a PDF file.',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Path to the PDF file' },
    },
    required: ['file_path'],
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    try {
      const filePath = String(input.file_path)
      const pdfParse = (await import('pdf-parse')).default
      const buffer = readFileSync(filePath)
      const data = await pdfParse(buffer)
      const stats = statSync(filePath)

      const info = {
        pages: data.numpages,
        title: data.info?.Title || '(none)',
        author: data.info?.Author || '(none)',
        creator: data.info?.Creator || '(none)',
        producer: data.info?.Producer || '(none)',
        creationDate: data.info?.CreationDate || '(none)',
        fileSize: `${(stats.size / 1024).toFixed(1)} KB`,
        textLength: data.text.length,
      }

      return { output: JSON.stringify(info, null, 2), isError: false, metadata: info }
    } catch (err) {
      return { output: `PDF info error: ${(err as Error).message}`, isError: true }
    }
  },
})

function parsePageRange(range: string, maxPages: number): number[] {
  const pages: number[] = []
  for (const part of range.split(',')) {
    const trimmed = part.trim()
    if (trimmed.includes('-')) {
      const [start, end] = trimmed.split('-').map(Number)
      for (let i = Math.max(1, start); i <= Math.min(maxPages, end); i++) {
        pages.push(i)
      }
    } else {
      const n = Number(trimmed)
      if (n >= 1 && n <= maxPages) pages.push(n)
    }
  }
  return pages
}
