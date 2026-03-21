import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockReadFileSync, mockStatSync } = vi.hoisted(() => ({
  mockReadFileSync: vi.fn().mockReturnValue(Buffer.from('fake pdf')),
  mockStatSync: vi.fn().mockReturnValue({ size: 4096 }),
}))

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal() as any
  return { ...actual, readFileSync: mockReadFileSync, writeFileSync: vi.fn(), statSync: mockStatSync }
})

// Mock pdf-parse
const mockPdfParse = vi.fn().mockResolvedValue({
  text: 'Page 1 content\fPage 2 content\fPage 3 content',
  numpages: 3,
  info: { Title: 'Test Doc', Author: 'Tester', Creator: 'Test', Producer: 'Test', CreationDate: '2025-01-01' },
})
vi.mock('pdf-parse', () => ({ default: mockPdfParse }))

// Mock playwright for pdf_generate
const mockPdf = vi.fn().mockResolvedValue(undefined)
const mockSetContent = vi.fn().mockResolvedValue(undefined)
const mockNewPage = vi.fn().mockResolvedValue({
  setContent: mockSetContent,
  pdf: mockPdf,
})
const mockClose = vi.fn().mockResolvedValue(undefined)
vi.mock('playwright', () => ({
  chromium: {
    launch: vi.fn().mockResolvedValue({
      newPage: mockNewPage,
      close: mockClose,
    }),
  },
}))

import { getSkill } from '../../../src/skills/index.js'
import '../../../src/skills/pdf.js'

const ctx: any = { userId: 'u1', channelType: 'test', threadId: 't1', memories: [] }

describe('pdf skills', () => {
  beforeEach(() => vi.clearAllMocks())

  describe('pdf_extract', () => {
    const skill = getSkill('pdf_extract')!

    it('extracts all text from PDF', async () => {
      const res = await skill.handler({ file_path: '/tmp/test.pdf' }, ctx)
      expect(res.isError).toBe(false)
      expect(res.output).toContain('Page 1 content')
      expect(res.output).toContain('Page 2 content')
      expect(res.metadata?.pages).toBe(3)
    })

    it('extracts specific page range', async () => {
      const res = await skill.handler({ file_path: '/tmp/test.pdf', pages: '1-2' }, ctx)
      expect(res.isError).toBe(false)
      expect(res.output).toContain('Page 1 content')
      expect(res.output).toContain('Page 2 content')
      expect(res.output).not.toContain('Page 3 content')
    })

    it('extracts single page', async () => {
      const res = await skill.handler({ file_path: '/tmp/test.pdf', pages: '2' }, ctx)
      expect(res.output).toContain('Page 2 content')
      expect(res.output).not.toContain('Page 1 content')
    })

    it('truncates massive content', async () => {
      mockPdfParse.mockResolvedValueOnce({
        text: 'x'.repeat(200000),
        numpages: 1,
        info: {},
      })
      const res = await skill.handler({ file_path: '/tmp/big.pdf' }, ctx)
      expect(res.output).toContain('truncated')
      expect(res.output.length).toBeLessThan(200000)
    })

    it('handles read errors', async () => {
      mockReadFileSync.mockImplementationOnce(() => { throw new Error('File not found') })
      const res = await skill.handler({ file_path: '/tmp/missing.pdf' }, ctx)
      expect(res.isError).toBe(true)
      expect(res.output).toContain('File not found')
    })
  })

  describe('pdf_generate', () => {
    const skill = getSkill('pdf_generate')!

    it('generates PDF from HTML', async () => {
      const res = await skill.handler({ html: '<h1>Hello</h1>', output_path: '/tmp/out.pdf' }, ctx)
      expect(res.isError).toBe(false)
      expect(res.output).toContain('PDF generated')
      expect(mockSetContent).toHaveBeenCalledWith(expect.stringContaining('<h1>Hello</h1>'), expect.any(Object))
      expect(mockClose).toHaveBeenCalled()
    })

    it('uses landscape mode', async () => {
      await skill.handler({ html: '<p>test</p>', output_path: '/tmp/out.pdf', landscape: true }, ctx)
      expect(mockPdf).toHaveBeenCalledWith(expect.objectContaining({ landscape: true }))
    })

    it('uses custom margin', async () => {
      await skill.handler({ html: '<p>test</p>', output_path: '/tmp/out.pdf', margin: '2cm' }, ctx)
      expect(mockPdf).toHaveBeenCalledWith(expect.objectContaining({
        margin: { top: '2cm', right: '2cm', bottom: '2cm', left: '2cm' },
      }))
    })
  })

  describe('pdf_info', () => {
    const skill = getSkill('pdf_info')!

    it('returns PDF metadata', async () => {
      const res = await skill.handler({ file_path: '/tmp/test.pdf' }, ctx)
      expect(res.isError).toBe(false)
      const info = JSON.parse(res.output)
      expect(info.pages).toBe(3)
      expect(info.title).toBe('Test Doc')
      expect(info.author).toBe('Tester')
      expect(info.fileSize).toContain('KB')
    })
  })
})
