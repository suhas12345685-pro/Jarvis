import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockJoinMeeting, mockAnswerCall, mockMakeCall, mockEndSession, mockListActiveSessions, mockGetActiveSession, mockGenerateMeetingResponse } = vi.hoisted(() => ({
  mockJoinMeeting: vi.fn(),
  mockAnswerCall: vi.fn(),
  mockMakeCall: vi.fn(),
  mockEndSession: vi.fn(),
  mockListActiveSessions: vi.fn().mockReturnValue([]),
  mockGetActiveSession: vi.fn().mockReturnValue(null),
  mockGenerateMeetingResponse: vi.fn().mockResolvedValue('I understand, let me help.'),
}))

vi.mock('../../../src/meetingEngine.js', () => ({
  joinMeeting: mockJoinMeeting,
  answerCall: mockAnswerCall,
  makeCall: mockMakeCall,
  endSession: mockEndSession,
  listActiveSessions: mockListActiveSessions,
  getActiveSession: mockGetActiveSession,
  addTranscript: vi.fn(),
  generateMeetingResponse: mockGenerateMeetingResponse,
}))

import { getSkill } from '../../../src/skills/index.js'
import { initMeetingSkills } from '../../../src/skills/meetingCall.js'

const ctx: any = { userId: 'u1', channelType: 'test', threadId: 't1', memories: [] }
const mockConfig: any = { llmProvider: 'test' }
const mockMemory: any = { recall: vi.fn() }

describe('meetingCall skills', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    initMeetingSkills(mockConfig, mockMemory)
  })

  describe('meeting_join', () => {
    const skill = getSkill('meeting_join')!

    it('joins a meeting successfully', async () => {
      mockJoinMeeting.mockResolvedValue({ id: 'sess-1', status: 'active' })
      const res = await skill.handler({ meetingUrl: 'https://zoom.us/j/123' }, ctx)
      expect(res.isError).toBe(false)
      expect(res.output).toContain('sess-1')
    })

    it('returns error when meeting fails to connect', async () => {
      mockJoinMeeting.mockResolvedValue({ id: 'sess-1', status: 'ended' })
      const res = await skill.handler({ meetingUrl: 'https://zoom.us/j/123' }, ctx)
      expect(res.isError).toBe(true)
    })
  })

  describe('meeting_speak', () => {
    const skill = getSkill('meeting_speak')!

    it('generates and speaks response', async () => {
      const res = await skill.handler({ sessionId: 'sess-1', message: 'What is the agenda?' }, ctx)
      expect(res.isError).toBe(false)
      expect(res.output).toContain('JARVIS said')
    })
  })

  describe('meeting_end', () => {
    const skill = getSkill('meeting_end')!

    it('ends meeting with summary', async () => {
      mockEndSession.mockResolvedValue({
        summary: 'Discussed Q1 goals',
        actionItems: ['Follow up on budget', 'Schedule design review'],
      })
      const res = await skill.handler({ sessionId: 'sess-1' }, ctx)
      expect(res.isError).toBe(false)
      expect(res.output).toContain('Discussed Q1 goals')
      expect(res.output).toContain('Follow up on budget')
    })
  })

  describe('meeting_list_active', () => {
    const skill = getSkill('meeting_list_active')!

    it('lists active sessions', async () => {
      mockListActiveSessions.mockReturnValue([
        { id: 's1', type: 'meeting', status: 'active', startedAt: new Date(), participants: ['Alice'], transcript: [] },
      ])
      const res = await skill.handler({}, ctx)
      expect(res.output).toContain('1 active session')
    })

    it('handles no active sessions', async () => {
      mockListActiveSessions.mockReturnValue([])
      const res = await skill.handler({}, ctx)
      expect(res.output).toContain('No active meetings')
    })
  })

  describe('call_answer', () => {
    const skill = getSkill('call_answer')!

    it('answers an inbound call', async () => {
      mockAnswerCall.mockResolvedValue({ id: 'call-1', status: 'active' })
      const res = await skill.handler({ from: '+1234567890' }, ctx)
      expect(res.isError).toBe(false)
      expect(res.output).toContain('+1234567890')
    })
  })

  describe('call_make', () => {
    const skill = getSkill('call_make')!

    it('makes an outbound call', async () => {
      mockMakeCall.mockResolvedValue({ id: 'call-2', status: 'ringing' })
      const res = await skill.handler({ to: '+0987654321', purpose: 'Schedule meeting' }, ctx)
      expect(res.isError).toBe(false)
      expect(res.output).toContain('+0987654321')
    })
  })

  describe('meeting_get_transcript', () => {
    const skill = getSkill('meeting_get_transcript')!

    it('returns transcript entries', async () => {
      mockGetActiveSession.mockReturnValue({
        transcript: [
          { timestamp: new Date('2025-01-01T10:00:00Z'), speaker: 'Alice', text: 'Hello everyone' },
          { timestamp: new Date('2025-01-01T10:01:00Z'), speaker: 'JARVIS', text: 'Hello Alice' },
        ],
      })
      const res = await skill.handler({ sessionId: 'sess-1' }, ctx)
      expect(res.output).toContain('Alice')
      expect(res.output).toContain('Hello everyone')
    })

    it('returns error for missing session', async () => {
      mockGetActiveSession.mockReturnValue(null)
      const res = await skill.handler({ sessionId: 'bad' }, ctx)
      expect(res.isError).toBe(true)
    })
  })

  describe('meeting_get_notes', () => {
    const skill = getSkill('meeting_get_notes')!

    it('returns notes and action items', async () => {
      mockGetActiveSession.mockReturnValue({
        notes: ['Key decision: go with plan A'],
        actionItems: ['Alice to prepare slides'],
      })
      const res = await skill.handler({ sessionId: 'sess-1' }, ctx)
      expect(res.output).toContain('plan A')
      expect(res.output).toContain('Alice to prepare slides')
    })
  })
})
