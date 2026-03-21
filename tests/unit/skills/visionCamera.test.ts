import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock node-webcam
const mockCapture = vi.fn((_path: string, cb: (err: Error | null) => void) => cb(null))
vi.mock('node-webcam', () => ({
  default: { create: vi.fn().mockReturnValue({ capture: mockCapture }) },
}))

// Mock fs/promises
vi.mock('fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue(Buffer.from('fake-image-data')),
  unlink: vi.fn().mockResolvedValue(undefined),
}))

// Mock @anthropic-ai/sdk
const mockCreate = vi.fn().mockResolvedValue({
  content: [{ type: 'text', text: 'I can see a desk with a laptop and a coffee mug.' }],
})
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  })),
}))

// Mock config
vi.mock('../../../src/config.js', () => ({
  getByoakValue: vi.fn(() => 'test-api-key'),
}))

import { getSkill } from '../../../src/skills/index.js'
import '../../../src/skills/visionCamera.js'

const ctx: any = { userId: 'u1', byoak: {} }

describe('visionCamera skills', () => {
  beforeEach(() => vi.clearAllMocks())

  describe('vision_camera', () => {
    const skill = getSkill('vision_camera')!

    it('captures and analyzes camera frame', async () => {
      const res = await skill.handler({ question: 'What is on my desk?' }, ctx)
      expect(res.isError).toBe(false)
      expect(res.output).toContain('desk')
      expect(res.output).toContain('laptop')
      expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
        model: 'claude-sonnet-4-6',
        messages: expect.arrayContaining([
          expect.objectContaining({
            content: expect.arrayContaining([
              expect.objectContaining({ type: 'image' }),
              expect.objectContaining({ type: 'text' }),
            ]),
          }),
        ]),
      }))
    })

    it('includes emotion context when available', async () => {
      const ctxWithEmotion: any = { ...ctx, emotionState: { mood: 'focused', primary: 'neutral' } }
      await skill.handler({ question: 'What do you see?' }, ctxWithEmotion)
      expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            content: expect.arrayContaining([
              expect.objectContaining({ text: expect.stringContaining('focused') }),
            ]),
          }),
        ]),
      }))
    })

    it('handles camera not available', async () => {
      mockCapture.mockImplementationOnce((_path: string, cb: (err: Error | null) => void) => cb(new Error('No cameras available')))
      const res = await skill.handler({ question: 'test' }, ctx)
      expect(res.isError).toBe(true)
      expect(res.output).toContain('camera')
    })
  })
})
