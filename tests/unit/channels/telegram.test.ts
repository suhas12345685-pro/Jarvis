import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock grammy
const mockBotOn = vi.fn()
const mockBotCatch = vi.fn()
const mockBotStart = vi.fn().mockResolvedValue(undefined)

vi.mock('grammy', () => ({
  Bot: vi.fn().mockImplementation(() => ({
    on: mockBotOn,
    catch: mockBotCatch,
    start: mockBotStart,
  })),
}))

vi.mock('../../../src/config.js', () => ({
  getByoakValue: vi.fn(() => null),
}))

vi.mock('../../../src/logger.js', () => ({
  getLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}))

import { startTelegramPolling } from '../../../src/channels/telegram.js'

describe('channels/telegram', () => {
  const originalEnv = process.env.TELEGRAM_MODE

  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.TELEGRAM_MODE
  })

  afterEach(() => {
    if (originalEnv !== undefined) process.env.TELEGRAM_MODE = originalEnv
    else delete process.env.TELEGRAM_MODE
  })

  const mockQueue: any = { add: vi.fn() }
  const mockMemory: any = {}

  it('does nothing when bot token not configured', async () => {
    const config: any = { byoak: [] }
    await startTelegramPolling(config, mockMemory, mockQueue)
    expect(mockBotStart).not.toHaveBeenCalled()
  })

  it('does nothing when mode is webhook (default)', async () => {
    const { getByoakValue } = await import('../../../src/config.js')
    ;(getByoakValue as any).mockReturnValue('bot-token')

    const config: any = { byoak: [] }
    await startTelegramPolling(config, mockMemory, mockQueue)
    expect(mockBotStart).not.toHaveBeenCalled()
  })

  it('starts polling when mode is poll', async () => {
    process.env.TELEGRAM_MODE = 'poll'
    const { getByoakValue } = await import('../../../src/config.js')
    ;(getByoakValue as any).mockReturnValue('bot-token')

    const config: any = { byoak: [] }
    await startTelegramPolling(config, mockMemory, mockQueue)

    expect(mockBotOn).toHaveBeenCalledWith('message:text', expect.any(Function))
    expect(mockBotCatch).toHaveBeenCalledWith(expect.any(Function))
    expect(mockBotStart).toHaveBeenCalled()
  })
})
