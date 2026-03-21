import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/logger.js', () => ({
  getLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}))

vi.mock('../../src/config.js', () => ({
  getByoakValue: vi.fn(() => null),
}))

vi.mock('../../src/emotionEngine.js', () => ({
  getEmotionEngine: vi.fn().mockReturnValue({
    updateEmotion: vi.fn(),
    getOrCreateState: vi.fn().mockReturnValue({ primary: 'neutral', mood: 'calm' }),
    getPersonality: vi.fn().mockReturnValue({}),
    generateEmpatheticResponse: vi.fn().mockReturnValue({ response: 'test' }),
    calibratePersonalityFromInteraction: vi.fn(),
  }),
}))

vi.mock('../../src/llm/registry.js', () => ({
  getProvider: vi.fn().mockReturnValue({ chat: vi.fn().mockResolvedValue({ text: 'response' }) }),
}))

import { startVoiceEngine } from '../../src/voiceEngine.js'

describe('voiceEngine', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns early when LiveKit not configured', async () => {
    const config: any = {
      byoak: [],
      llmProvider: 'anthropic',
      llmModel: 'claude-sonnet-4-6',
      anthropicApiKey: 'key',
    }
    const memory: any = { semanticSearch: vi.fn(), insertMemory: vi.fn() }

    // Should not throw
    await startVoiceEngine(config, memory)
  })

  it('returns early when @livekit/agents not installed', async () => {
    const { getByoakValue } = await import('../../src/config.js')
    // Mock LiveKit credentials being present
    ;(getByoakValue as any).mockImplementation((_byoak: any, service: string, key: string) => {
      if (service === 'livekit') {
        if (key === 'URL') return 'wss://test.livekit.cloud'
        if (key === 'API_KEY') return 'api-key'
        if (key === 'API_SECRET') return 'api-secret'
      }
      return null
    })

    const config: any = {
      byoak: [
        { service: 'livekit', keyName: 'URL', value: 'wss://test' },
        { service: 'livekit', keyName: 'API_KEY', value: 'key' },
        { service: 'livekit', keyName: 'API_SECRET', value: 'secret' },
      ],
      llmProvider: 'anthropic',
      llmModel: 'claude-sonnet-4-6',
      anthropicApiKey: 'key',
    }
    const memory: any = { semanticSearch: vi.fn(), insertMemory: vi.fn() }

    // Should not throw - @livekit/agents isn't installed
    await startVoiceEngine(config, memory)
  })
})
