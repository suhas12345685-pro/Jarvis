import type { ByoakEntry } from './config.js'
import type { EmotionState, PersonalityProfile } from './emotions.js'

export type ChannelType = 'slack' | 'telegram' | 'voice' | 'api' | 'discord' | 'gchat'

export interface Memory {
  id: string
  content: string
  embedding: number[]
  metadata: Record<string, unknown>
  createdAt: Date
}

export interface AgentContext {
  channelType: ChannelType
  userId: string
  threadId: string
  rawMessage: string
  memories: Memory[]
  systemPrompt: string
  byoak: ByoakEntry[]
  emotionState?: EmotionState
  personality?: PersonalityProfile
  interimMessageId?: string
  sendInterim: (message: string) => Promise<string | undefined>
  sendFinal: (message: string, interimId?: string) => Promise<void>
}

export interface ToolCall {
  id: string
  name: string
  input: Record<string, unknown>
}

export interface ToolResult {
  toolCallId: string
  content: string
  isError: boolean
}
