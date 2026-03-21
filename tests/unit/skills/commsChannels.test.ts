import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock @slack/web-api
const mockPostMessage = vi.fn().mockResolvedValue({ ts: '123.456' })
const mockChatUpdate = vi.fn().mockResolvedValue({})
vi.mock('@slack/web-api', () => ({
  WebClient: vi.fn().mockImplementation(() => ({
    chat: { postMessage: mockPostMessage, update: mockChatUpdate },
  })),
}))

// Mock grammy
const mockSendMessage = vi.fn().mockResolvedValue({ message_id: 42 })
vi.mock('grammy', () => ({
  Bot: vi.fn().mockImplementation(() => ({
    api: { sendMessage: mockSendMessage },
  })),
}))

// Mock config
vi.mock('../../../src/config.js', () => ({
  getByoakValue: vi.fn((byoak: any, provider: string, key: string) => {
    return byoak?.[`${provider}_${key}`] || ''
  }),
}))

import { getSkill } from '../../../src/skills/index.js'
import '../../../src/skills/commsChannels.js'

describe('commsChannels skills', () => {
  beforeEach(() => vi.clearAllMocks())

  describe('slack_send', () => {
    const skill = getSkill('slack_send')!

    it('sends message to Slack channel', async () => {
      const ctx: any = { byoak: { slack_BOT_TOKEN: 'xoxb-test' } }
      const res = await skill.handler({ channel: '#general', message: 'Hello!' }, ctx)
      expect(res.isError).toBe(false)
      expect(res.output).toContain('#general')
      expect(mockPostMessage).toHaveBeenCalledWith(expect.objectContaining({
        channel: '#general',
        text: 'Hello!',
      }))
    })

    it('sends threaded reply', async () => {
      const ctx: any = { byoak: { slack_BOT_TOKEN: 'xoxb-test' } }
      await skill.handler({ channel: '#general', message: 'Reply', threadTs: '111.222' }, ctx)
      expect(mockPostMessage).toHaveBeenCalledWith(expect.objectContaining({
        thread_ts: '111.222',
      }))
    })

    it('returns error when not configured', async () => {
      const ctx: any = { byoak: {} }
      const res = await skill.handler({ channel: '#general', message: 'test' }, ctx)
      expect(res.isError).toBe(true)
      expect(res.output).toContain('not configured')
    })

    it('handles Slack API errors', async () => {
      mockPostMessage.mockRejectedValueOnce(new Error('channel_not_found'))
      const ctx: any = { byoak: { slack_BOT_TOKEN: 'xoxb-test' } }
      const res = await skill.handler({ channel: '#nonexistent', message: 'test' }, ctx)
      expect(res.isError).toBe(true)
      expect(res.output).toContain('channel_not_found')
    })
  })

  describe('slack_update_message', () => {
    const skill = getSkill('slack_update_message')!

    it('updates existing message', async () => {
      const ctx: any = { byoak: { slack_BOT_TOKEN: 'xoxb-test' } }
      const res = await skill.handler({ channel: '#general', ts: '123.456', message: 'Updated!' }, ctx)
      expect(res.isError).toBe(false)
      expect(mockChatUpdate).toHaveBeenCalledWith(expect.objectContaining({
        channel: '#general',
        ts: '123.456',
        text: 'Updated!',
      }))
    })

    it('returns error when not configured', async () => {
      const ctx: any = { byoak: {} }
      const res = await skill.handler({ channel: '#general', ts: '123', message: 'test' }, ctx)
      expect(res.isError).toBe(true)
    })
  })

  describe('telegram_send', () => {
    const skill = getSkill('telegram_send')!

    it('sends Telegram message', async () => {
      const ctx: any = { byoak: { telegram_BOT_TOKEN: 'bot123:abc' } }
      const res = await skill.handler({ chatId: '12345', message: 'Hello from JARVIS!' }, ctx)
      expect(res.isError).toBe(false)
      expect(res.output).toContain('Telegram message sent')
      expect(mockSendMessage).toHaveBeenCalledWith('12345', 'Hello from JARVIS!', expect.any(Object))
    })

    it('returns error when not configured', async () => {
      const ctx: any = { byoak: {} }
      const res = await skill.handler({ chatId: '12345', message: 'test' }, ctx)
      expect(res.isError).toBe(true)
      expect(res.output).toContain('not configured')
    })

    it('handles Telegram API errors', async () => {
      mockSendMessage.mockRejectedValueOnce(new Error('chat not found'))
      const ctx: any = { byoak: { telegram_BOT_TOKEN: 'bot123:abc' } }
      const res = await skill.handler({ chatId: 'bad', message: 'test' }, ctx)
      expect(res.isError).toBe(true)
    })
  })
})
