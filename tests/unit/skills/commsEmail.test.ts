import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock nodemailer
const mockSendMail = vi.fn().mockResolvedValue({ messageId: 'msg-123' })
vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn().mockReturnValue({ sendMail: mockSendMail }),
  },
}))

// Mock imap-simple
const mockSearch = vi.fn().mockResolvedValue([])
const mockOpenBox = vi.fn().mockResolvedValue(undefined)
const mockEnd = vi.fn()
vi.mock('imap-simple', () => ({
  default: {
    connect: vi.fn().mockResolvedValue({
      openBox: mockOpenBox,
      search: mockSearch,
      end: mockEnd,
    }),
  },
}))

// Mock config
vi.mock('../../../src/config.js', () => ({
  getByoakValue: vi.fn((byoak: any, provider: string, key: string) => {
    return byoak?.[`${provider}_${key}`] || null
  }),
}))

import { getSkill } from '../../../src/skills/index.js'
import '../../../src/skills/commsEmail.js'

describe('commsEmail skills', () => {
  beforeEach(() => vi.clearAllMocks())

  describe('email_send', () => {
    const skill = getSkill('email_send')!

    it('sends plain text email', async () => {
      const ctx: any = { byoak: { email_SMTP_HOST: 'smtp.test.com', email_SMTP_PORT: '587', email_SMTP_USER: 'me@test.com', email_SMTP_PASS: 'pass' } }
      const res = await skill.handler({ to: 'you@test.com', subject: 'Hi', body: 'Hello!' }, ctx)
      expect(res.isError).toBe(false)
      expect(res.output).toContain('Email sent')
      expect(res.output).toContain('msg-123')
      expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({
        to: 'you@test.com',
        subject: 'Hi',
        text: 'Hello!',
      }))
    })

    it('sends HTML email when isHtml is true', async () => {
      const ctx: any = { byoak: { email_SMTP_HOST: 'smtp.test.com', email_SMTP_PORT: '465', email_SMTP_USER: 'me@test.com', email_SMTP_PASS: 'pass' } }
      const res = await skill.handler({ to: 'you@test.com', subject: 'Hi', body: '<h1>Hello</h1>', isHtml: true }, ctx)
      expect(res.isError).toBe(false)
      expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({
        html: '<h1>Hello</h1>',
      }))
    })

    it('returns error when not configured', async () => {
      const ctx: any = { byoak: {} }
      const res = await skill.handler({ to: 'test@test.com', subject: 'Test', body: 'body' }, ctx)
      expect(res.isError).toBe(true)
      expect(res.output).toContain('not configured')
    })

    it('handles send errors', async () => {
      mockSendMail.mockRejectedValueOnce(new Error('Auth failed'))
      const ctx: any = { byoak: { email_SMTP_HOST: 'smtp.test.com', email_SMTP_PORT: '587', email_SMTP_USER: 'me@test.com', email_SMTP_PASS: 'pass' } }
      const res = await skill.handler({ to: 'test@test.com', subject: 'Test', body: 'body' }, ctx)
      expect(res.isError).toBe(true)
      expect(res.output).toContain('Auth failed')
    })
  })

  describe('email_read', () => {
    const skill = getSkill('email_read')!

    it('reads emails from IMAP', async () => {
      mockSearch.mockResolvedValueOnce([
        {
          parts: [
            { which: 'HEADER.FIELDS (FROM TO SUBJECT DATE)', body: { from: ['boss@test.com'], subject: ['Important'], date: ['2025-01-01'] } },
            { which: 'TEXT', body: 'This is the email body content' },
          ],
        },
      ])
      const ctx: any = { byoak: { email_IMAP_HOST: 'imap.test.com', email_IMAP_USER: 'me@test.com', email_IMAP_PASS: 'pass' } }
      const res = await skill.handler({}, ctx)
      expect(res.isError).toBe(false)
      expect(res.output).toContain('boss@test.com')
      expect(res.output).toContain('Important')
    })

    it('returns no emails found', async () => {
      mockSearch.mockResolvedValueOnce([])
      const ctx: any = { byoak: { email_IMAP_HOST: 'imap.test.com', email_IMAP_USER: 'me@test.com', email_IMAP_PASS: 'pass' } }
      const res = await skill.handler({}, ctx)
      expect(res.output).toContain('No emails found')
    })

    it('returns error when IMAP not configured', async () => {
      const ctx: any = { byoak: {} }
      const res = await skill.handler({}, ctx)
      expect(res.isError).toBe(true)
      expect(res.output).toContain('not configured')
    })
  })
})
