import { registerSkill } from './index.js'
import type { AgentContext, SkillResult } from '../types/index.js'
import {
  joinMeeting,
  answerCall,
  makeCall,
  endSession,
  listActiveSessions,
  getActiveSession,
  addTranscript,
  generateMeetingResponse,
} from '../meetingEngine.js'

// Note: The meeting engine requires config & memory — these are obtained
// at runtime via a lazy singleton pattern since skills don't have direct config access.

let _config: import('../types/index.js').AppConfig | null = null
let _memory: import('../memoryLayer.js').MemoryLayer | null = null

export function initMeetingSkills(
  config: import('../types/index.js').AppConfig,
  memory: import('../memoryLayer.js').MemoryLayer
): void {
  _config = config
  _memory = memory
}

registerSkill({
  name: 'meeting_join',
  description: 'Join a meeting or video call. JARVIS will participate as an AI assistant — listening, taking notes, and answering questions.',
  inputSchema: {
    type: 'object',
    properties: {
      meetingUrl: { type: 'string', description: 'Meeting URL (Zoom, Teams, Meet, or LiveKit room)' },
      roomName: { type: 'string', description: 'LiveKit room name (alternative to URL)' },
      autoSpeak: { type: 'boolean', description: 'Whether JARVIS should speak in the meeting (default: true)' },
      noteTaking: { type: 'boolean', description: 'Enable automatic note-taking (default: true)' },
    },
  },
  handler: async (input: Record<string, unknown>, ctx: AgentContext): Promise<SkillResult> => {
    if (!_config || !_memory) {
      return { output: 'Meeting engine not initialized', isError: true }
    }

    const session = await joinMeeting(_config, _memory, {
      meetingUrl: input.meetingUrl as string | undefined,
      roomName: input.roomName as string | undefined,
      userId: ctx.userId,
      autoSpeak: input.autoSpeak !== false,
      noteTaking: input.noteTaking !== false,
    })

    if (session.status === 'ended') {
      return { output: 'Failed to join meeting — check LiveKit configuration.', isError: true }
    }

    return {
      output: `Joined meeting (session: ${session.id}). Status: ${session.status}. Auto note-taking is active.`,
      isError: false,
      metadata: { sessionId: session.id },
    }
  },
})

registerSkill({
  name: 'meeting_speak',
  description: 'Make JARVIS say something in an active meeting or call.',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'Meeting/call session ID' },
      message: { type: 'string', description: 'What JARVIS should say or respond to' },
    },
    required: ['sessionId', 'message'],
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    if (!_config || !_memory) {
      return { output: 'Meeting engine not initialized', isError: true }
    }

    const response = await generateMeetingResponse(
      String(input.sessionId),
      _config,
      _memory,
      String(input.message)
    )

    return { output: `JARVIS said: "${response}"`, isError: false }
  },
})

registerSkill({
  name: 'meeting_end',
  description: 'End an active meeting/call session and get a summary with action items.',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'Session ID to end' },
    },
    required: ['sessionId'],
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    if (!_config || !_memory) {
      return { output: 'Meeting engine not initialized', isError: true }
    }

    const { summary, actionItems } = await endSession(String(input.sessionId), _config, _memory)

    const itemList = actionItems.length > 0
      ? `\n\nAction Items:\n${actionItems.map((a, i) => `${i + 1}. ${a}`).join('\n')}`
      : ''

    return {
      output: `Meeting ended.\n\nSummary:\n${summary}${itemList}`,
      isError: false,
    }
  },
})

registerSkill({
  name: 'meeting_list_active',
  description: 'List all active meetings and calls.',
  inputSchema: { type: 'object', properties: {} },
  handler: async (_input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    const sessions = listActiveSessions()

    if (sessions.length === 0) {
      return { output: 'No active meetings or calls.', isError: false }
    }

    const output = sessions.map(s =>
      `• ${s.id} (${s.type}) — ${s.status}\n  Started: ${s.startedAt.toISOString()}\n  Participants: ${s.participants.join(', ')}\n  Transcript entries: ${s.transcript.length}`
    ).join('\n\n')

    return { output: `${sessions.length} active session(s):\n\n${output}`, isError: false }
  },
})

registerSkill({
  name: 'call_answer',
  description: 'Answer an inbound phone call. JARVIS will handle the conversation autonomously using voice AI.',
  inputSchema: {
    type: 'object',
    properties: {
      callSid: { type: 'string', description: 'Twilio Call SID' },
      from: { type: 'string', description: 'Caller phone number' },
      to: { type: 'string', description: 'Called phone number' },
    },
    required: ['from'],
  },
  handler: async (input: Record<string, unknown>, ctx: AgentContext): Promise<SkillResult> => {
    if (!_config || !_memory) {
      return { output: 'Meeting engine not initialized', isError: true }
    }

    const session = await answerCall(_config, _memory, {
      callSid: String(input.callSid ?? ''),
      from: String(input.from),
      to: String(input.to ?? ''),
      userId: ctx.userId,
    })

    if (session.status === 'ended') {
      return { output: 'Failed to answer call — check Twilio configuration.', isError: true }
    }

    return {
      output: `Answering call from ${input.from} (session: ${session.id}). JARVIS is handling the conversation.`,
      isError: false,
      metadata: { sessionId: session.id },
    }
  },
})

registerSkill({
  name: 'call_make',
  description: 'Make an outbound phone call. JARVIS will call the number and handle the conversation.',
  inputSchema: {
    type: 'object',
    properties: {
      to: { type: 'string', description: 'Phone number to call (E.164 format, e.g. +1234567890)' },
      purpose: { type: 'string', description: 'Purpose of the call — JARVIS will use this as context' },
      script: { type: 'string', description: 'Optional: specific script/talking points for JARVIS to follow' },
    },
    required: ['to', 'purpose'],
  },
  handler: async (input: Record<string, unknown>, ctx: AgentContext): Promise<SkillResult> => {
    if (!_config || !_memory) {
      return { output: 'Meeting engine not initialized', isError: true }
    }

    const session = await makeCall(_config, _memory, {
      to: String(input.to),
      purpose: String(input.purpose),
      userId: ctx.userId,
      script: input.script as string | undefined,
    })

    if (session.status === 'ended') {
      return { output: 'Failed to make call — check Twilio configuration.', isError: true }
    }

    return {
      output: `Calling ${input.to} (session: ${session.id}). Purpose: ${input.purpose}`,
      isError: false,
      metadata: { sessionId: session.id },
    }
  },
})

registerSkill({
  name: 'meeting_get_transcript',
  description: 'Get the transcript of an active or ended meeting/call.',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'Session ID' },
      last: { type: 'number', description: 'Only return last N entries (default: all)' },
    },
    required: ['sessionId'],
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    const session = getActiveSession(String(input.sessionId))
    if (!session) return { output: 'Session not found', isError: true }

    const entries = input.last
      ? session.transcript.slice(-Number(input.last))
      : session.transcript

    if (entries.length === 0) {
      return { output: 'No transcript entries yet.', isError: false }
    }

    const output = entries
      .map(e => `[${e.timestamp.toISOString()}] ${e.speaker}: ${e.text}`)
      .join('\n')

    return { output: output.slice(0, 8000), isError: false }
  },
})

registerSkill({
  name: 'meeting_get_notes',
  description: 'Get the notes and action items from a meeting/call.',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'Session ID' },
    },
    required: ['sessionId'],
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    const session = getActiveSession(String(input.sessionId))
    if (!session) return { output: 'Session not found', isError: true }

    const notes = session.notes.length > 0
      ? `Notes:\n${session.notes.join('\n\n')}`
      : 'No notes yet.'

    const items = session.actionItems.length > 0
      ? `\n\nAction Items:\n${session.actionItems.map((a, i) => `${i + 1}. ${a}`).join('\n')}`
      : ''

    return { output: `${notes}${items}`, isError: false }
  },
})
