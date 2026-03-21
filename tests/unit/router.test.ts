import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock all heavy dependencies
vi.mock('bullmq', () => ({
  Queue: vi.fn().mockImplementation(() => ({ add: vi.fn() })),
  Worker: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
  })),
}))

vi.mock('../../src/logger.js', () => ({
  getLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}))

vi.mock('../../src/security.js', () => ({
  IPRateLimiter: vi.fn().mockImplementation(() => ({
    isAllowed: vi.fn().mockReturnValue(true),
  })),
}))

vi.mock('../../src/emotionEngine.js', () => ({
  getEmotionEngine: vi.fn().mockReturnValue({
    updateEmotion: vi.fn(),
    getOrCreateState: vi.fn().mockReturnValue({ primary: 'neutral', intensity: 0.5, mood: 'calm' }),
    getPersonality: vi.fn().mockReturnValue({}),
    generateEmpatheticResponse: vi.fn().mockReturnValue({ response: 'test' }),
    decayEmotions: vi.fn(),
    getEmotionalSummary: vi.fn().mockReturnValue({ mood: 'calm' }),
    calibratePersonalityFromInteraction: vi.fn(),
  }),
}))

vi.mock('../../src/consciousness.js', () => ({
  getConsciousness: vi.fn().mockReturnValue({
    onMessageReceived: vi.fn(),
    onResponseGenerated: vi.fn(),
    onLoadChange: vi.fn(),
  }),
}))

vi.mock('../../src/toolCaller.js', () => ({
  runToolLoop: vi.fn().mockResolvedValue('Mock response'),
  runStreamingToolLoop: vi.fn().mockResolvedValue('Mock streaming response'),
}))

import { createRouter, jarvisEvents } from '../../src/router.js'
import request from 'supertest'

const mockConfig: any = {
  redisUrl: 'redis://localhost:6379',
  byoak: [],
  llmProvider: 'anthropic',
  llmModel: 'claude-sonnet-4-6',
  anthropicApiKey: 'test',
}

const mockMemory: any = {
  semanticSearch: vi.fn().mockResolvedValue([]),
  insertMemory: vi.fn().mockResolvedValue(undefined),
}

describe('router', () => {
  let app: any

  beforeEach(() => {
    vi.clearAllMocks()
    const router = createRouter(mockConfig, mockMemory)
    app = router.app
  })

  describe('GET /health', () => {
    it('returns ok status', async () => {
      const res = await request(app).get('/health')
      expect(res.status).toBe(200)
      expect(res.body.status).toBe('ok')
    })
  })

  describe('POST /api/message', () => {
    it('returns 400 when userId missing', async () => {
      const res = await request(app)
        .post('/api/message')
        .send({ message: 'hello' })
      expect(res.status).toBe(400)
      expect(res.body.error).toContain('userId')
    })

    it('returns 400 when message missing', async () => {
      const res = await request(app)
        .post('/api/message')
        .send({ userId: 'u1' })
      expect(res.status).toBe(400)
    })

    it('processes valid message', async () => {
      const res = await request(app)
        .post('/api/message')
        .send({ userId: 'u1', message: 'hello JARVIS' })
      expect(res.status).toBe(200)
      expect(res.body.result).toBeDefined()
    })
  })

  describe('POST /webhooks/slack', () => {
    it('returns 403 when signing secret not configured', async () => {
      const res = await request(app)
        .post('/webhooks/slack')
        .set('Content-Type', 'application/json')
        .send(Buffer.from(JSON.stringify({ type: 'url_verification', challenge: 'abc' })))
      expect(res.status).toBe(403)
    })
  })

  describe('POST /webhooks/telegram', () => {
    it('returns 200 for messages without text', async () => {
      const res = await request(app)
        .post('/webhooks/telegram')
        .send({ message: { from: { id: 1 }, chat: { id: 1 } } })
      expect(res.status).toBe(200)
    })
  })

  describe('POST /webhooks/gchat', () => {
    it('returns 200 for non-MESSAGE events', async () => {
      const res = await request(app)
        .post('/webhooks/gchat')
        .send({ type: 'ADDED_TO_SPACE' })
      expect(res.status).toBe(200)
    })
  })

  describe('GET /api/emotions/:userId', () => {
    it('returns emotion summary', async () => {
      const res = await request(app).get('/api/emotions/u1')
      expect(res.status).toBe(200)
      expect(res.body.mood).toBe('calm')
    })
  })

  describe('jarvisEvents', () => {
    it('is an EventEmitter', () => {
      expect(jarvisEvents).toBeDefined()
      expect(typeof jarvisEvents.emit).toBe('function')
      expect(typeof jarvisEvents.on).toBe('function')
    })
  })
})
