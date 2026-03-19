import { registerSkill } from './index.js'
import type { AgentContext, SkillResult } from '../types/index.js'
import { getByoakValue } from '../config.js'
import { getLogger } from '../logger.js'

registerSkill({
  name: 'notify_slack',
  description: 'Send a notification to a Slack channel or user.',
  inputSchema: {
    type: 'object',
    properties: {
      channel: { type: 'string', description: 'Slack channel ID or #channel-name' },
      message: { type: 'string', description: 'Message text (supports Slack mrkdwn)' },
      blocks: { description: 'Optional: Slack Block Kit blocks array for rich formatting' },
    },
    required: ['channel', 'message'],
  },
  handler: async (input: Record<string, unknown>, ctx: AgentContext): Promise<SkillResult> => {
    const botToken = getByoakValue(ctx.byoak, 'slack', 'BOT_TOKEN')
    if (!botToken) return { output: 'Slack not configured (missing BYOAK_SLACK_BOT_TOKEN)', isError: true }

    try {
      const { WebClient } = await import('@slack/web-api')
      const client = new WebClient(botToken)

      const result = await client.chat.postMessage({
        channel: String(input.channel),
        text: String(input.message),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        blocks: input.blocks as any,
      })

      return { output: `Sent to ${input.channel} (ts: ${result.ts})`, isError: false }
    } catch (err) {
      return { output: `Slack error: ${(err as Error).message}`, isError: true }
    }
  },
})

registerSkill({
  name: 'notify_webhook',
  description: 'Send a notification via a generic webhook (Discord, Teams, Slack incoming, etc.).',
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Webhook URL' },
      message: { type: 'string', description: 'Notification message' },
      format: {
        type: 'string',
        enum: ['slack', 'discord', 'teams', 'generic'],
        description: 'Webhook format (default: generic)',
      },
    },
    required: ['url', 'message'],
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    const { default: axios } = await import('axios')
    const { validateUrl } = await import('../security.js')

    const urlCheck = validateUrl(String(input.url))
    if (!urlCheck.valid) return { output: `BLOCKED: ${urlCheck.error}`, isError: true }

    const format = String(input.format ?? 'generic')
    const message = String(input.message)

    let body: Record<string, unknown>
    switch (format) {
      case 'slack':
        body = { text: message }
        break
      case 'discord':
        body = { content: message }
        break
      case 'teams':
        body = { '@type': 'MessageCard', text: message }
        break
      default:
        body = { message }
    }

    try {
      await axios.post(String(input.url), body, { timeout: 10_000 })
      return { output: `Webhook notification sent (${format})`, isError: false }
    } catch (err) {
      return { output: `Webhook error: ${(err as Error).message}`, isError: true }
    }
  },
})

registerSkill({
  name: 'notify_email_quick',
  description: 'Send a quick email notification (uses configured SMTP).',
  inputSchema: {
    type: 'object',
    properties: {
      to: { type: 'string', description: 'Recipient email address' },
      subject: { type: 'string', description: 'Email subject' },
      body: { type: 'string', description: 'Email body (plain text)' },
      priority: { type: 'string', enum: ['high', 'normal', 'low'], description: 'Priority (default: normal)' },
    },
    required: ['to', 'subject', 'body'],
  },
  handler: async (input: Record<string, unknown>, ctx: AgentContext): Promise<SkillResult> => {
    const smtpHost = getByoakValue(ctx.byoak, 'email', 'SMTP_HOST')
    const smtpPort = getByoakValue(ctx.byoak, 'email', 'SMTP_PORT')
    const smtpUser = getByoakValue(ctx.byoak, 'email', 'SMTP_USER')
    const smtpPass = getByoakValue(ctx.byoak, 'email', 'SMTP_PASS')

    if (!smtpHost || !smtpUser || !smtpPass) {
      return { output: 'Email SMTP not configured', isError: true }
    }

    try {
      const nodemailer = await import('nodemailer')
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: Number(smtpPort ?? 587),
        secure: false,
        auth: { user: smtpUser, pass: smtpPass },
      })

      await transporter.sendMail({
        from: smtpUser,
        to: String(input.to),
        subject: String(input.subject),
        text: String(input.body),
        priority: (input.priority ?? 'normal') as 'high' | 'normal' | 'low',
      })

      return { output: `Email sent to ${input.to}`, isError: false }
    } catch (err) {
      return { output: `Email error: ${(err as Error).message}`, isError: true }
    }
  },
})
