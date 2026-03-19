import { registerSkill } from './index.js'
import type { AgentContext, SkillResult } from '../types/index.js'
import { getByoakValue } from '../config.js'

registerSkill({
  name: 'email_send',
  description: 'Send an email via SMTP (uses BYOAK_EMAIL_SMTP_* credentials).',
  inputSchema: {
    type: 'object',
    properties: {
      to: { type: 'string', description: 'Recipient email address' },
      subject: { type: 'string', description: 'Email subject line' },
      body: { type: 'string', description: 'Email body (plain text or HTML)' },
      isHtml: { type: 'boolean', description: 'Set to true if body is HTML (default: false)' },
    },
    required: ['to', 'subject', 'body'],
  },
  handler: async (input: Record<string, unknown>, ctx: AgentContext): Promise<SkillResult> => {
    const host = getByoakValue(ctx.byoak, 'email', 'SMTP_HOST')
    const port = parseInt(getByoakValue(ctx.byoak, 'email', 'SMTP_PORT') ?? '587', 10)
    const user = getByoakValue(ctx.byoak, 'email', 'SMTP_USER')
    const pass = getByoakValue(ctx.byoak, 'email', 'SMTP_PASS')

    if (!host || !user || !pass) {
      return { output: 'Email not configured: missing BYOAK_EMAIL_SMTP_* credentials', isError: true }
    }

    try {
      const nodemailer = await import('nodemailer')
      const transporter = nodemailer.default.createTransport({
        host, port, secure: port === 465,
        auth: { user, pass },
      })

      const info = await transporter.sendMail({
        from: user,
        to: String(input.to),
        subject: String(input.subject),
        [input.isHtml ? 'html' : 'text']: String(input.body),
      })

      return { output: `Email sent. Message ID: ${info.messageId}`, isError: false }
    } catch (err) {
      return { output: `Email send error: ${(err as Error).message}`, isError: true }
    }
  },
})

registerSkill({
  name: 'email_read',
  description: 'Read emails from IMAP inbox. Can search by subject, sender, or date range.',
  inputSchema: {
    type: 'object',
    properties: {
      searchCriteria: {
        type: 'array',
        description: 'IMAP search criteria array (e.g. ["UNSEEN"] or ["FROM", "boss@example.com"])',
        items: { type: 'string' },
      },
      limit: { type: 'number', description: 'Max number of emails to fetch (default: 10)' },
      folder: { type: 'string', description: 'Folder to search (default: INBOX)' },
    },
    required: [],
  },
  handler: async (input: Record<string, unknown>, ctx: AgentContext): Promise<SkillResult> => {
    const host = getByoakValue(ctx.byoak, 'email', 'IMAP_HOST')
    const user = getByoakValue(ctx.byoak, 'email', 'IMAP_USER')
    const pass = getByoakValue(ctx.byoak, 'email', 'IMAP_PASS')

    if (!host || !user || !pass) {
      return { output: 'Email not configured: missing BYOAK_EMAIL_IMAP_* credentials', isError: true }
    }

    try {
      const imapSimple = await import('imap-simple')
      const connection = await imapSimple.default.connect({
        imap: {
          host, port: 993, tls: true,
          authTimeout: 10000,
          auth: { user, pass },
        },
      })

      const folder = String(input.folder ?? 'INBOX')
      await connection.openBox(folder)

      const criteria = (input.searchCriteria as string[]) ?? ['ALL']
      const limit = Number(input.limit ?? 10)

      const messages = await connection.search(criteria, {
        bodies: ['HEADER.FIELDS (FROM TO SUBJECT DATE)', 'TEXT'],
        markSeen: false,
      })

      const results = messages.slice(-limit).map(msg => {
        const header = msg.parts.find((p: { which: string }) => p.which === 'HEADER.FIELDS (FROM TO SUBJECT DATE)')
        const text = msg.parts.find((p: { which: string }) => p.which === 'TEXT')
        const h = header?.body as Record<string, string[]>
        return `From: ${h?.from?.[0] ?? 'unknown'}
Subject: ${h?.subject?.[0] ?? 'no subject'}
Date: ${h?.date?.[0] ?? 'unknown'}
---
${(text?.body as string)?.slice(0, 500) ?? ''}
`
      })

      connection.end()
      return {
        output: results.length > 0 ? results.join('\n====\n') : 'No emails found',
        isError: false,
      }
    } catch (err) {
      return { output: `Email read error: ${(err as Error).message}`, isError: true }
    }
  },
})
