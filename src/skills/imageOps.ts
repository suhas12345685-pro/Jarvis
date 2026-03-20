/**
 * Image operation skills — resize, convert, QR code generation.
 * Uses sharp for image processing and qrcode for QR generation.
 */
import { registerSkill } from './index.js'
import type { AgentContext, SkillResult } from '../types/index.js'
import { statSync, existsSync } from 'fs'

registerSkill({
  name: 'image_resize',
  description: 'Resize an image to specified dimensions. Supports JPEG, PNG, WebP, AVIF, TIFF.',
  inputSchema: {
    type: 'object',
    properties: {
      input_path: { type: 'string', description: 'Path to the input image' },
      output_path: { type: 'string', description: 'Path to save the resized image' },
      width: { type: 'number', description: 'Target width in pixels' },
      height: { type: 'number', description: 'Target height in pixels' },
      fit: { type: 'string', description: 'Resize fit mode: cover, contain, fill, inside, outside (default: inside)' },
      quality: { type: 'number', description: 'Output quality 1-100 (default: 80)' },
    },
    required: ['input_path', 'output_path'],
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    try {
      const sharp = (await import('sharp')).default
      const inputPath = String(input.input_path)
      const outputPath = String(input.output_path)

      if (!existsSync(inputPath)) {
        return { output: `Input file not found: ${inputPath}`, isError: true }
      }

      let pipeline = sharp(inputPath)

      if (input.width || input.height) {
        pipeline = pipeline.resize({
          width: input.width ? Number(input.width) : undefined,
          height: input.height ? Number(input.height) : undefined,
          fit: (String(input.fit || 'inside')) as any,
        })
      }

      const quality = Number(input.quality || 80)

      if (outputPath.endsWith('.jpg') || outputPath.endsWith('.jpeg')) {
        pipeline = pipeline.jpeg({ quality })
      } else if (outputPath.endsWith('.png')) {
        pipeline = pipeline.png()
      } else if (outputPath.endsWith('.webp')) {
        pipeline = pipeline.webp({ quality })
      } else if (outputPath.endsWith('.avif')) {
        pipeline = pipeline.avif({ quality })
      }

      await pipeline.toFile(outputPath)
      const stats = statSync(outputPath)
      const metadata = await sharp(outputPath).metadata()

      return {
        output: `Resized image saved: ${outputPath} (${metadata.width}x${metadata.height}, ${(stats.size / 1024).toFixed(1)} KB)`,
        isError: false,
        metadata: { width: metadata.width, height: metadata.height, size: stats.size },
      }
    } catch (err) {
      return { output: `Image resize error: ${(err as Error).message}`, isError: true }
    }
  },
})

registerSkill({
  name: 'image_convert',
  description: 'Convert an image between formats (JPEG, PNG, WebP, AVIF, TIFF).',
  inputSchema: {
    type: 'object',
    properties: {
      input_path: { type: 'string', description: 'Path to the input image' },
      output_path: { type: 'string', description: 'Path for the converted image (format detected from extension)' },
      quality: { type: 'number', description: 'Output quality 1-100 (default: 80)' },
    },
    required: ['input_path', 'output_path'],
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    try {
      const sharp = (await import('sharp')).default
      const inputPath = String(input.input_path)
      const outputPath = String(input.output_path)

      if (!existsSync(inputPath)) {
        return { output: `Input file not found: ${inputPath}`, isError: true }
      }

      const quality = Number(input.quality || 80)
      let pipeline = sharp(inputPath)

      const ext = outputPath.split('.').pop()?.toLowerCase()
      switch (ext) {
        case 'jpg': case 'jpeg': pipeline = pipeline.jpeg({ quality }); break
        case 'png': pipeline = pipeline.png(); break
        case 'webp': pipeline = pipeline.webp({ quality }); break
        case 'avif': pipeline = pipeline.avif({ quality }); break
        case 'tiff': case 'tif': pipeline = pipeline.tiff({ quality }); break
        default: return { output: `Unsupported output format: .${ext}`, isError: true }
      }

      await pipeline.toFile(outputPath)
      const stats = statSync(outputPath)

      return {
        output: `Converted: ${inputPath} → ${outputPath} (${(stats.size / 1024).toFixed(1)} KB)`,
        isError: false,
      }
    } catch (err) {
      return { output: `Image convert error: ${(err as Error).message}`, isError: true }
    }
  },
})

registerSkill({
  name: 'qr_generate',
  description: 'Generate a QR code image from text or URL.',
  inputSchema: {
    type: 'object',
    properties: {
      data: { type: 'string', description: 'Text, URL, or data to encode in the QR code' },
      output_path: { type: 'string', description: 'Path to save the QR code image (PNG)' },
      size: { type: 'number', description: 'Image size in pixels (default: 300)' },
      dark: { type: 'string', description: 'Dark color hex (default: #000000)' },
      light: { type: 'string', description: 'Light/background color hex (default: #ffffff)' },
    },
    required: ['data', 'output_path'],
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    try {
      const QRCode = await import('qrcode')
      const data = String(input.data)
      const outputPath = String(input.output_path)
      const size = Number(input.size || 300)

      await QRCode.toFile(outputPath, data, {
        width: size,
        color: {
          dark: String(input.dark || '#000000'),
          light: String(input.light || '#ffffff'),
        },
      })

      const stats = statSync(outputPath)
      return {
        output: `QR code generated: ${outputPath} (${(stats.size / 1024).toFixed(1)} KB)`,
        isError: false,
        metadata: { path: outputPath, data, size },
      }
    } catch (err) {
      return { output: `QR generate error: ${(err as Error).message}`, isError: true }
    }
  },
})

registerSkill({
  name: 'image_metadata',
  description: 'Get metadata (dimensions, format, color space, EXIF) of an image file.',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Path to the image file' },
    },
    required: ['file_path'],
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    try {
      const sharp = (await import('sharp')).default
      const filePath = String(input.file_path)

      if (!existsSync(filePath)) {
        return { output: `File not found: ${filePath}`, isError: true }
      }

      const metadata = await sharp(filePath).metadata()
      const stats = statSync(filePath)

      const info = {
        format: metadata.format,
        width: metadata.width,
        height: metadata.height,
        channels: metadata.channels,
        colorSpace: metadata.space,
        depth: metadata.depth,
        density: metadata.density,
        hasAlpha: metadata.hasAlpha,
        orientation: metadata.orientation,
        fileSize: `${(stats.size / 1024).toFixed(1)} KB`,
      }

      return { output: JSON.stringify(info, null, 2), isError: false, metadata: info }
    } catch (err) {
      return { output: `Image metadata error: ${(err as Error).message}`, isError: true }
    }
  },
})
