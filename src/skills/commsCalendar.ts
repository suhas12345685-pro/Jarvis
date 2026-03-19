import { registerSkill } from './index.js'
import type { AgentContext, SkillResult } from '../types/index.js'
import { getByoakValue } from '../config.js'

async function getCalendarClient(ctx: AgentContext) {
  const clientId = getByoakValue(ctx.byoak, 'gcal', 'CLIENT_ID')
  const clientSecret = getByoakValue(ctx.byoak, 'gcal', 'CLIENT_SECRET')
  const refreshToken = getByoakValue(ctx.byoak, 'gcal', 'REFRESH_TOKEN')

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Google Calendar not configured: missing BYOAK_GCAL_* credentials')
  }

  const { google } = await import('googleapis')
  const auth = new google.auth.OAuth2(clientId, clientSecret)
  auth.setCredentials({ refresh_token: refreshToken })
  return google.calendar({ version: 'v3', auth })
}

registerSkill({
  name: 'calendar_list_events',
  description: 'List upcoming calendar events within a date range.',
  inputSchema: {
    type: 'object',
    properties: {
      timeMin: { type: 'string', description: 'Start datetime in ISO 8601 format (default: now)' },
      timeMax: { type: 'string', description: 'End datetime in ISO 8601 format (default: 7 days from now)' },
      maxResults: { type: 'number', description: 'Maximum events to return (default: 10)' },
      calendarId: { type: 'string', description: 'Calendar ID (default: primary)' },
    },
    required: [],
  },
  handler: async (input: Record<string, unknown>, ctx: AgentContext): Promise<SkillResult> => {
    try {
      const calendar = await getCalendarClient(ctx)
      const now = new Date()
      const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

      const res = await calendar.events.list({
        calendarId: String(input.calendarId ?? 'primary'),
        timeMin: String(input.timeMin ?? now.toISOString()),
        timeMax: String(input.timeMax ?? weekFromNow.toISOString()),
        maxResults: Number(input.maxResults ?? 10),
        singleEvents: true,
        orderBy: 'startTime',
      })

      const events = res.data.items ?? []
      if (events.length === 0) return { output: 'No events found in this time range', isError: false }

      const formatted = events.map(e => {
        const start = e.start?.dateTime ?? e.start?.date ?? 'unknown'
        const end = e.end?.dateTime ?? e.end?.date ?? 'unknown'
        return `• ${e.summary ?? 'Untitled'}\n  ${start} → ${end}\n  ${e.location ?? ''}${e.description ? '\n  ' + e.description.slice(0, 100) : ''}`
      })

      return { output: formatted.join('\n\n'), isError: false }
    } catch (err) {
      return { output: `Calendar error: ${(err as Error).message}`, isError: true }
    }
  },
})

registerSkill({
  name: 'calendar_create_event',
  description: 'Create a new calendar event.',
  inputSchema: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: 'Event title' },
      startDateTime: { type: 'string', description: 'Start datetime in ISO 8601 format' },
      endDateTime: { type: 'string', description: 'End datetime in ISO 8601 format' },
      description: { type: 'string', description: 'Event description (optional)' },
      location: { type: 'string', description: 'Event location (optional)' },
      attendeeEmails: {
        type: 'array',
        items: { type: 'string' },
        description: 'List of attendee email addresses (optional)',
      },
      calendarId: { type: 'string', description: 'Calendar ID (default: primary)' },
    },
    required: ['summary', 'startDateTime', 'endDateTime'],
  },
  handler: async (input: Record<string, unknown>, ctx: AgentContext): Promise<SkillResult> => {
    try {
      const calendar = await getCalendarClient(ctx)
      const attendees = ((input.attendeeEmails as string[]) ?? []).map(email => ({ email }))

      const res = await calendar.events.insert({
        calendarId: String(input.calendarId ?? 'primary'),
        requestBody: {
          summary: String(input.summary),
          description: input.description ? String(input.description) : undefined,
          location: input.location ? String(input.location) : undefined,
          start: { dateTime: String(input.startDateTime), timeZone: 'UTC' },
          end: { dateTime: String(input.endDateTime), timeZone: 'UTC' },
          attendees: attendees.length > 0 ? attendees : undefined,
        },
      })

      return {
        output: `Event created: "${res.data.summary}" (ID: ${res.data.id})\nLink: ${res.data.htmlLink}`,
        isError: false,
      }
    } catch (err) {
      return { output: `Calendar create error: ${(err as Error).message}`, isError: true }
    }
  },
})

registerSkill({
  name: 'calendar_delete_event',
  description: 'Delete a calendar event by its event ID.',
  inputSchema: {
    type: 'object',
    properties: {
      eventId: { type: 'string', description: 'Calendar event ID to delete' },
      calendarId: { type: 'string', description: 'Calendar ID (default: primary)' },
    },
    required: ['eventId'],
  },
  handler: async (input: Record<string, unknown>, ctx: AgentContext): Promise<SkillResult> => {
    try {
      const calendar = await getCalendarClient(ctx)
      await calendar.events.delete({
        calendarId: String(input.calendarId ?? 'primary'),
        eventId: String(input.eventId),
      })
      return { output: `Event ${input.eventId} deleted`, isError: false }
    } catch (err) {
      return { output: `Calendar delete error: ${(err as Error).message}`, isError: true }
    }
  },
})
