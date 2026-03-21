import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockGetDiscordClient } = vi.hoisted(() => ({ mockGetDiscordClient: vi.fn() }))

vi.mock('../../../src/channels/discord.js', () => ({
  getDiscordClient: mockGetDiscordClient,
}))

import { getSkill } from '../../../src/skills/index.js'
import '../../../src/skills/commsDiscord.js'

const ctx: any = { userId: 'u1', channelType: 'test', threadId: 't1', memories: [] }

describe('commsDiscord skills', () => {
  beforeEach(() => vi.clearAllMocks())

  describe('discord_send', () => {
    const skill = getSkill('discord_send')!

    it('sends message to Discord channel', async () => {
      const mockSend = vi.fn().mockResolvedValue({ id: 'msg-123' })
      mockGetDiscordClient.mockReturnValue({
        channels: {
          fetch: vi.fn().mockResolvedValue({ isTextBased: () => true, send: mockSend }),
        },
      })
      const res = await skill.handler({ channelId: '12345', message: 'Hello Discord!' }, ctx)
      expect(res.isError).toBe(false)
      expect(res.output).toContain('msg-123')
      expect(mockSend).toHaveBeenCalledWith('Hello Discord!')
    })

    it('returns error when Discord not configured', async () => {
      mockGetDiscordClient.mockReturnValue(null)
      const res = await skill.handler({ channelId: '12345', message: 'test' }, ctx)
      expect(res.isError).toBe(true)
      expect(res.output).toContain('not configured')
    })

    it('returns error when channel not text-based', async () => {
      mockGetDiscordClient.mockReturnValue({
        channels: {
          fetch: vi.fn().mockResolvedValue({ isTextBased: () => false }),
        },
      })
      const res = await skill.handler({ channelId: '12345', message: 'test' }, ctx)
      expect(res.isError).toBe(true)
      expect(res.output).toContain('not a text channel')
    })

    it('handles API errors', async () => {
      mockGetDiscordClient.mockReturnValue({
        channels: { fetch: vi.fn().mockRejectedValue(new Error('Unknown Channel')) },
      })
      const res = await skill.handler({ channelId: 'bad', message: 'test' }, ctx)
      expect(res.isError).toBe(true)
      expect(res.output).toContain('Unknown Channel')
    })
  })

  describe('discord_reply', () => {
    const skill = getSkill('discord_reply')!

    it('replies to a Discord message', async () => {
      const mockReply = vi.fn().mockResolvedValue({ id: 'reply-456' })
      mockGetDiscordClient.mockReturnValue({
        channels: {
          fetch: vi.fn().mockResolvedValue({
            isTextBased: () => true,
            messages: { fetch: vi.fn().mockResolvedValue({ reply: mockReply }) },
          }),
        },
      })
      const res = await skill.handler({ channelId: '12345', messageId: 'msg-123', message: 'Reply!' }, ctx)
      expect(res.isError).toBe(false)
      expect(res.output).toContain('reply-456')
    })

    it('returns error when Discord not connected', async () => {
      mockGetDiscordClient.mockReturnValue(null)
      const res = await skill.handler({ channelId: '12345', messageId: 'msg-123', message: 'test' }, ctx)
      expect(res.isError).toBe(true)
    })
  })
})
