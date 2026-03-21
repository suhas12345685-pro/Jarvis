import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock @slack/web-api
const mockPostMessage = vi.fn().mockResolvedValue({ ts: '123.456' })
const mockChatUpdate = vi.fn().mockResolvedValue({})
vi.mock('@slack/web-api', () => ({
  WebClient: vi.fn().mockImplementation(() => ({
    chat: { postMessage: mockPostMessage, update: mockChatUpdate },
  })),
}))

// Mock axios
const mockAxiosPost = vi.fn().mockResolvedValue({ data: 'ok' })
vi.mock('axios', () => ({ default: { post: mockAxiosPost } }))

// Mock security
vi.mock('../../../src/security.js', () => ({
  validateUrl: (url: string) => url.startsWith('http') ? { valid: true } : { valid: false, error: 'Invalid URL' },
}))

// Mock nodemailer
const mockSendMail = vi.fn().mockResolvedValue({ messageId: 'test-id' })
vi.mock('nodemailer', () => ({
  createTransport: vi.fn().mockReturnValue({ sendMail: mockSendMail }),
}))

// Mock config
vi.mock('../../../src/config.js', () => ({
  getByoakValue: vi.fn((byoak: any, provider: string, key: string) => {
    return byoak?.[`${provider}_${key}`] || ''
  }),
}))

vi.mock('../../../src/logger.js', () => ({
  getLogger: () => ({ info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() }),
}))

import { getSkill } from '../../../src/skills/index.js'
import '../../../src/skills/notifications.js'

describe('notifications skills', () => {
  beforeEach(() => vi.clearAllMocks())

  describe('notify_slack', () => {
    const skill = getSkill('notify_slack')!

    it('sends slack message', async () => {
      const ctx: any = { byoak: { slack_BOT_TOKEN: 'xoxb-test' } }
      const res = await skill.handler({ channel: '#general', message: 'Hello!' }, ctx)
      expect(res.isError).toBe(false)
      expect(res.output).toContain('#general')
      expect(mockPostMessage).toHaveBeenCalledWith(expect.objectContaining({
        channel: '#general',
        text: 'Hello!',
      }))
    })

    it('returns error when not configured', async () => {
      const ctx: any = { byoak: {} }
      const res = await skill.handler({ channel: '#general', message: 'test' }, ctx)
      expect(res.isError).toBe(true)
      expect(res.output).toContain('not configured')
    })
  })

  describe('notify_webhook', () => {
    const skill = getSkill('notify_webhook')!
    const ctx: any = { byoak: {} }

    it('sends slack-formatted webhook', async () => {
      const res = await skill.handler({ url: 'https://hooks.slack.com/test', message: 'Alert!', format: 'slack' }, ctx)
      expect(res.isError).toBe(false)
      expect(mockAxiosPost).toHaveBeenCalledWith('https://hooks.slack.com/test', { text: 'Alert!' }, expect.any(Object))
    })

    it('sends discord-formatted webhook', async () => {
      await skill.handler({ url: 'https://discord.com/api/webhooks/test', message: 'Alert!', format: 'discord' }, ctx)
      expect(mockAxiosPost).toHaveBeenCalledWith(expect.any(String), { content: 'Alert!' }, expect.any(Object))
    })

    it('sends teams-formatted webhook', async () => {
      await skill.handler({ url: 'https://teams.webhook.office.com/test', message: 'Alert!', format: 'teams' }, ctx)
      expect(mockAxiosPost).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ '@type': 'MessageCard', text: 'Alert!' }), expect.any(Object))
    })

    it('sends generic format by default', async () => {
      await skill.handler({ url: 'https://example.com/hook', message: 'Hello' }, ctx)
      expect(mockAxiosPost).toHaveBeenCalledWith(expect.any(String), { message: 'Hello' }, expect.any(Object))
    })

    it('blocks invalid URLs', async () => {
      const res = await skill.handler({ url: 'not-valid', message: 'test' }, ctx)
      expect(res.isError).toBe(true)
      expect(res.output).toContain('BLOCKED')
    })

    it('handles webhook errors', async () => {
      mockAxiosPost.mockRejectedValueOnce(new Error('Connection refused'))
      const res = await skill.handler({ url: 'https://example.com/hook', message: 'test' }, ctx)
      expect(res.isError).toBe(true)
    })
  })

  describe('notify_email_quick', () => {
    const skill = getSkill('notify_email_quick')!

    it('sends email when configured', async () => {
      const ctx: any = { byoak: { email_SMTP_HOST: 'smtp.test.com', email_SMTP_PORT: '587', email_SMTP_USER: 'user@test.com', email_SMTP_PASS: 'pass' } }
      const res = await skill.handler({ to: 'recipient@test.com', subject: 'Test', body: 'Hello' }, ctx)
      expect(res.isError).toBe(false)
      expect(res.output).toContain('Email sent')
    })

    it('returns error when SMTP not configured', async () => {
      const ctx: any = { byoak: {} }
      const res = await skill.handler({ to: 'test@test.com', subject: 'Test', body: 'body' }, ctx)
      expect(res.isError).toBe(true)
      expect(res.output).toContain('not configured')
    })
  })
})
