import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock screenshot-desktop
vi.mock('screenshot-desktop', () => ({
  default: vi.fn().mockResolvedValue(Buffer.from('fake-screenshot-data')),
}))

// Mock @anthropic-ai/sdk
const mockCreate = vi.fn().mockResolvedValue({
  content: [{ type: 'text', text: 'I can see VS Code is open with a TypeScript file.' }],
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
import '../../../src/skills/visionScreen.js'

const ctx: any = { userId: 'u1', byoak: {} }

describe('visionScreen skills', () => {
  beforeEach(() => vi.clearAllMocks())

  describe('vision_screen', () => {
    const skill = getSkill('vision_screen')!

    it('captures and analyzes screenshot', async () => {
      const res = await skill.handler({ question: 'What app is open?' }, ctx)
      expect(res.isError).toBe(false)
      expect(res.output).toContain('VS Code')
      expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
        model: 'claude-sonnet-4-6',
        messages: expect.arrayContaining([
          expect.objectContaining({
            content: expect.arrayContaining([
              expect.objectContaining({ type: 'image', source: expect.objectContaining({ media_type: 'image/png' }) }),
            ]),
          }),
        ]),
      }))
    })

    it('includes emotion context', async () => {
      const ctxWithEmotion: any = { ...ctx, emotionState: { mood: 'frustrated', primary: 'frustration' } }
      await skill.handler({ question: 'What error do you see?' }, ctxWithEmotion)
      expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            content: expect.arrayContaining([
              expect.objectContaining({ text: expect.stringContaining('patient') }),
            ]),
          }),
        ]),
      }))
    })

    it('handles screenshot errors', async () => {
      const screenshotMod = await import('screenshot-desktop')
      ;(screenshotMod.default as any).mockRejectedValueOnce(new Error('No display'))
      const res = await skill.handler({ question: 'test' }, ctx)
      expect(res.isError).toBe(true)
      expect(res.output).toContain('Screenshot error')
    })
  })
})
