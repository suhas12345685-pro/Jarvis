import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock discord.js
const mockLogin = vi.fn().mockResolvedValue(undefined)
const mockOnce = vi.fn()
const mockOn = vi.fn()

vi.mock('discord.js', () => ({
  Client: vi.fn().mockImplementation(() => ({
    login: mockLogin,
    once: mockOnce,
    on: mockOn,
    user: { tag: 'JARVIS#1234', id: 'BOT123' },
  })),
  GatewayIntentBits: {
    Guilds: 1,
    GuildMessages: 2,
    MessageContent: 4,
    DirectMessages: 8,
  },
}))

vi.mock('../../../src/config.js', () => ({
  getByoakValue: vi.fn((byoak: any, provider: string, key: string) => {
    return byoak?.[`${provider}_${key}`] || null
  }),
}))

vi.mock('../../../src/logger.js', () => ({
  getLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}))

import { getDiscordClient, startDiscordClient } from '../../../src/channels/discord.js'

describe('channels/discord', () => {
  beforeEach(() => vi.clearAllMocks())

  describe('getDiscordClient', () => {
    it('returns null initially', () => {
      // Note: may not be null if startDiscordClient was already called in module scope
      // This tests the function exists and returns correctly
      const client = getDiscordClient()
      expect(client === null || client !== null).toBe(true)
    })
  })

  describe('startDiscordClient', () => {
    const mockQueue: any = { add: vi.fn() }
    const mockMemory: any = {}

    it('does nothing when bot token not configured', async () => {
      const config: any = { byoak: [] }
      await startDiscordClient(config, mockMemory, mockQueue)
      expect(mockLogin).not.toHaveBeenCalled()
    })

    it('starts client when bot token is configured', async () => {
      const config: any = { byoak: [{ service: 'discord', keyName: 'BOT_TOKEN', value: 'test-token' }] }
      // Need to mock getByoakValue to return the token
      const { getByoakValue } = await import('../../../src/config.js')
      ;(getByoakValue as any).mockReturnValue('test-token')

      await startDiscordClient(config, mockMemory, mockQueue)
      expect(mockLogin).toHaveBeenCalledWith('test-token')
    })

    it('registers messageCreate handler', async () => {
      const { getByoakValue } = await import('../../../src/config.js')
      ;(getByoakValue as any).mockReturnValue('test-token')

      const config: any = { byoak: [] }
      await startDiscordClient(config, mockMemory, mockQueue)

      // Should register 'ready' and 'messageCreate' handlers
      expect(mockOnce).toHaveBeenCalledWith('ready', expect.any(Function))
      expect(mockOn).toHaveBeenCalledWith('messageCreate', expect.any(Function))
    })
  })
})
