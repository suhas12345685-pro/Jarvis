import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock googleapis
const mockEventsList = vi.fn().mockResolvedValue({
  data: {
    items: [
      { summary: 'Team Standup', start: { dateTime: '2025-01-01T09:00:00Z' }, end: { dateTime: '2025-01-01T09:30:00Z' }, location: 'Room A' },
      { summary: 'Lunch', start: { dateTime: '2025-01-01T12:00:00Z' }, end: { dateTime: '2025-01-01T13:00:00Z' } },
    ],
  },
})
const mockEventsInsert = vi.fn().mockResolvedValue({
  data: { summary: 'New Event', id: 'evt-123', htmlLink: 'https://calendar.google.com/event?id=evt-123' },
})
const mockEventsDelete = vi.fn().mockResolvedValue({})

vi.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: vi.fn().mockImplementation(() => ({ setCredentials: vi.fn() })),
    },
    calendar: vi.fn().mockReturnValue({
      events: {
        list: mockEventsList,
        insert: mockEventsInsert,
        delete: mockEventsDelete,
      },
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
import '../../../src/skills/commsCalendar.js'

const configuredCtx: any = {
  byoak: { gcal_CLIENT_ID: 'id', gcal_CLIENT_SECRET: 'secret', gcal_REFRESH_TOKEN: 'token' },
}

describe('commsCalendar skills', () => {
  beforeEach(() => vi.clearAllMocks())

  describe('calendar_list_events', () => {
    const skill = getSkill('calendar_list_events')!

    it('lists upcoming events', async () => {
      const res = await skill.handler({}, configuredCtx)
      expect(res.isError).toBe(false)
      expect(res.output).toContain('Team Standup')
      expect(res.output).toContain('Lunch')
    })

    it('handles no events', async () => {
      mockEventsList.mockResolvedValueOnce({ data: { items: [] } })
      const res = await skill.handler({}, configuredCtx)
      expect(res.output).toContain('No events found')
    })

    it('returns error when not configured', async () => {
      const res = await skill.handler({}, { byoak: {} })
      expect(res.isError).toBe(true)
      expect(res.output).toContain('not configured')
    })
  })

  describe('calendar_create_event', () => {
    const skill = getSkill('calendar_create_event')!

    it('creates a new event', async () => {
      const res = await skill.handler({
        summary: 'Meeting',
        startDateTime: '2025-01-02T10:00:00Z',
        endDateTime: '2025-01-02T11:00:00Z',
      }, configuredCtx)
      expect(res.isError).toBe(false)
      expect(res.output).toContain('Event created')
      expect(res.output).toContain('evt-123')
    })

    it('creates event with attendees', async () => {
      await skill.handler({
        summary: 'Meeting',
        startDateTime: '2025-01-02T10:00:00Z',
        endDateTime: '2025-01-02T11:00:00Z',
        attendeeEmails: ['a@test.com', 'b@test.com'],
      }, configuredCtx)
      expect(mockEventsInsert).toHaveBeenCalledWith(expect.objectContaining({
        requestBody: expect.objectContaining({
          attendees: [{ email: 'a@test.com' }, { email: 'b@test.com' }],
        }),
      }))
    })

    it('uses custom timezone', async () => {
      await skill.handler({
        summary: 'Meeting',
        startDateTime: '2025-01-02T10:00:00',
        endDateTime: '2025-01-02T11:00:00',
        timeZone: 'America/New_York',
      }, configuredCtx)
      expect(mockEventsInsert).toHaveBeenCalledWith(expect.objectContaining({
        requestBody: expect.objectContaining({
          start: expect.objectContaining({ timeZone: 'America/New_York' }),
        }),
      }))
    })
  })

  describe('calendar_delete_event', () => {
    const skill = getSkill('calendar_delete_event')!

    it('deletes an event', async () => {
      const res = await skill.handler({ eventId: 'evt-123' }, configuredCtx)
      expect(res.isError).toBe(false)
      expect(res.output).toContain('deleted')
      expect(mockEventsDelete).toHaveBeenCalledWith(expect.objectContaining({ eventId: 'evt-123' }))
    })
  })
})
