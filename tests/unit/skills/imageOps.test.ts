import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock sharp
const mockToFile = vi.fn().mockResolvedValue(undefined)
const mockMetadata = vi.fn().mockResolvedValue({ width: 800, height: 600, format: 'jpeg', channels: 3, space: 'srgb', depth: 'uchar', hasAlpha: false })
const mockResize = vi.fn().mockReturnThis()
const mockJpeg = vi.fn().mockReturnThis()
const mockPng = vi.fn().mockReturnThis()
const mockWebp = vi.fn().mockReturnThis()
const mockAvif = vi.fn().mockReturnThis()
const mockTiff = vi.fn().mockReturnThis()

const sharpInstance = {
  resize: mockResize,
  jpeg: mockJpeg,
  png: mockPng,
  webp: mockWebp,
  avif: mockAvif,
  tiff: mockTiff,
  toFile: mockToFile,
  metadata: mockMetadata,
}

vi.mock('sharp', () => ({
  default: vi.fn().mockReturnValue(sharpInstance),
}))

// Mock qrcode
const mockQrToFile = vi.fn().mockResolvedValue(undefined)
vi.mock('qrcode', () => ({
  toFile: mockQrToFile,
}))

// Mock fs
const { mockExistsSync, mockStatSync } = vi.hoisted(() => ({
  mockExistsSync: vi.fn().mockReturnValue(true),
  mockStatSync: vi.fn().mockReturnValue({ size: 51200 }),
}))
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal() as any
  return { ...actual, existsSync: mockExistsSync, statSync: mockStatSync }
})

import { getSkill } from '../../../src/skills/index.js'
import '../../../src/skills/imageOps.js'

const ctx: any = { userId: 'u1', channelType: 'test', threadId: 't1', memories: [] }

describe('imageOps skills', () => {
  beforeEach(() => vi.clearAllMocks())

  describe('image_resize', () => {
    const skill = getSkill('image_resize')!

    it('resizes image with width and height', async () => {
      const res = await skill.handler({ input_path: '/tmp/photo.jpg', output_path: '/tmp/resized.jpg', width: 400, height: 300 }, ctx)
      expect(res.isError).toBe(false)
      expect(res.output).toContain('Resized image saved')
      expect(mockResize).toHaveBeenCalledWith(expect.objectContaining({ width: 400, height: 300 }))
    })

    it('returns error when input file missing', async () => {
      mockExistsSync.mockReturnValueOnce(false)
      const res = await skill.handler({ input_path: '/tmp/missing.jpg', output_path: '/tmp/out.jpg' }, ctx)
      expect(res.isError).toBe(true)
      expect(res.output).toContain('not found')
    })

    it('uses jpeg format for .jpg output', async () => {
      await skill.handler({ input_path: '/tmp/photo.png', output_path: '/tmp/out.jpg', width: 100 }, ctx)
      expect(mockJpeg).toHaveBeenCalled()
    })

    it('uses webp format for .webp output', async () => {
      await skill.handler({ input_path: '/tmp/photo.png', output_path: '/tmp/out.webp', width: 100 }, ctx)
      expect(mockWebp).toHaveBeenCalled()
    })
  })

  describe('image_convert', () => {
    const skill = getSkill('image_convert')!

    it('converts image to png', async () => {
      const res = await skill.handler({ input_path: '/tmp/photo.jpg', output_path: '/tmp/photo.png' }, ctx)
      expect(res.isError).toBe(false)
      expect(res.output).toContain('Converted')
      expect(mockPng).toHaveBeenCalled()
    })

    it('returns error for unsupported format', async () => {
      const res = await skill.handler({ input_path: '/tmp/photo.jpg', output_path: '/tmp/photo.bmp' }, ctx)
      expect(res.isError).toBe(true)
      expect(res.output).toContain('Unsupported')
    })

    it('returns error when input file missing', async () => {
      mockExistsSync.mockReturnValueOnce(false)
      const res = await skill.handler({ input_path: '/tmp/missing.jpg', output_path: '/tmp/out.png' }, ctx)
      expect(res.isError).toBe(true)
    })
  })

  describe('qr_generate', () => {
    const skill = getSkill('qr_generate')!

    it('generates QR code', async () => {
      const res = await skill.handler({ data: 'https://example.com', output_path: '/tmp/qr.png' }, ctx)
      expect(res.isError).toBe(false)
      expect(res.output).toContain('QR code generated')
      expect(mockQrToFile).toHaveBeenCalledWith('/tmp/qr.png', 'https://example.com', expect.any(Object))
    })

    it('uses custom size and colors', async () => {
      await skill.handler({ data: 'test', output_path: '/tmp/qr.png', size: 500, dark: '#ff0000', light: '#00ff00' }, ctx)
      expect(mockQrToFile).toHaveBeenCalledWith('/tmp/qr.png', 'test', expect.objectContaining({
        width: 500,
        color: { dark: '#ff0000', light: '#00ff00' },
      }))
    })
  })

  describe('image_metadata', () => {
    const skill = getSkill('image_metadata')!

    it('returns image metadata', async () => {
      const res = await skill.handler({ file_path: '/tmp/photo.jpg' }, ctx)
      expect(res.isError).toBe(false)
      const info = JSON.parse(res.output)
      expect(info.width).toBe(800)
      expect(info.height).toBe(600)
      expect(info.format).toBe('jpeg')
    })

    it('returns error for missing file', async () => {
      mockExistsSync.mockReturnValueOnce(false)
      const res = await skill.handler({ file_path: '/tmp/missing.jpg' }, ctx)
      expect(res.isError).toBe(true)
    })
  })
})
