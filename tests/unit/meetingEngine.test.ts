import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/logger.js', () => ({
  getLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}))

vi.mock('../../src/config.js', () => ({
  getByoakValue: vi.fn(() => null),
}))

vi.mock('../../src/llm/registry.js', () => ({
  getProvider: vi.fn().mockReturnValue({
    chat: vi.fn().mockResolvedValue({ text: 'Summary of the meeting' }),
  }),
}))

import {
  getActiveSession,
  listActiveSessions,
  addTranscript,
  joinMeeting,
  answerCall,
  makeCall,
  endSession,
} from '../../src/meetingEngine.js'

const mockConfig: any = {
  llmProvider: 'anthropic',
  llmModel: 'claude-sonnet-4-6',
  anthropicApiKey: 'test-key',
  byoak: [],
}
const mockMemory: any = {
  semanticSearch: vi.fn().mockResolvedValue([]),
  insertMemory: vi.fn().mockResolvedValue(undefined),
}

describe('meetingEngine', () => {
  beforeEach(() => vi.clearAllMocks())

  describe('joinMeeting', () => {
    it('creates session and returns ended when LiveKit not configured', async () => {
      const session = await joinMeeting(mockConfig, mockMemory, { userId: 'u1' })
      expect(session.type).toBe('meeting')
      expect(session.status).toBe('ended')
      expect(session.participants).toContain('u1')
    })

    it('sets roomName from options', async () => {
      const session = await joinMeeting(mockConfig, mockMemory, { userId: 'u1', roomName: 'my-room' })
      expect(session.roomName).toBe('my-room')
    })
  })

  describe('answerCall', () => {
    it('creates session and returns ended when Twilio not configured', async () => {
      const session = await answerCall(mockConfig, mockMemory, {
        callSid: 'CA123', from: '+1234567890', to: '+0987654321', userId: 'u1',
      })
      expect(session.type).toBe('call_inbound')
      expect(session.status).toBe('ended')
      expect(session.phoneNumber).toBe('+1234567890')
    })
  })

  describe('makeCall', () => {
    it('creates session and returns ended when Twilio not configured', async () => {
      const session = await makeCall(mockConfig, mockMemory, {
        to: '+1234567890', purpose: 'Schedule meeting', userId: 'u1',
      })
      expect(session.type).toBe('call_outbound')
      expect(session.status).toBe('ended')
    })
  })

  describe('addTranscript', () => {
    it('adds transcript entry to active session', async () => {
      const session = await joinMeeting(mockConfig, mockMemory, { userId: 'u1' })
      // Even though session is 'ended', let's set it to active for this test
      session.status = 'active'
      addTranscript(session.id, 'Alice', 'Hello everyone')
      expect(session.transcript).toHaveLength(1)
      expect(session.transcript[0].speaker).toBe('Alice')
      expect(session.transcript[0].text).toBe('Hello everyone')
    })

    it('does not add to ended session', async () => {
      const session = await joinMeeting(mockConfig, mockMemory, { userId: 'u1' })
      addTranscript(session.id, 'Alice', 'Hello')
      expect(session.transcript).toHaveLength(0) // session is ended
    })

    it('ignores unknown session ID', () => {
      addTranscript('nonexistent', 'Bob', 'test')
      // Should not throw
    })
  })

  describe('getActiveSession', () => {
    it('returns session by ID', async () => {
      const session = await joinMeeting(mockConfig, mockMemory, { userId: 'u1' })
      const found = getActiveSession(session.id)
      expect(found).toBeDefined()
      expect(found!.id).toBe(session.id)
    })

    it('returns undefined for unknown ID', () => {
      expect(getActiveSession('nonexistent')).toBeUndefined()
    })
  })

  describe('listActiveSessions', () => {
    it('filters out ended sessions', async () => {
      const s1 = await joinMeeting(mockConfig, mockMemory, { userId: 'u1' })
      // s1 is ended (no LiveKit config)
      const active = listActiveSessions()
      const hasS1 = active.some(s => s.id === s1.id)
      expect(hasS1).toBe(false)
    })
  })

  describe('endSession', () => {
    it('returns not found for unknown session', async () => {
      const result = await endSession('nonexistent', mockConfig, mockMemory)
      expect(result.summary).toContain('not found')
    })

    it('ends session and returns no transcript message', async () => {
      const session = await joinMeeting(mockConfig, mockMemory, { userId: 'u1' })
      session.status = 'active' // Force active for testing
      const result = await endSession(session.id, mockConfig, mockMemory)
      expect(result.summary).toContain('No transcript')
      expect(session.status).toBe('ended')
    })
  })
})
