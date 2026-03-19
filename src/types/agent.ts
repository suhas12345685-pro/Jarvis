import type { ByoakEntry } from './config.js'

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
  /** Used by commsChannels to update the interim "Working on it..." message */
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
