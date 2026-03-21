import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the LLM layer
const mockChat = vi.fn()
vi.mock('../../../src/llm/registry.js', () => ({
  getProvider: () => ({ chat: mockChat }),
}))
vi.mock('../../../src/config.js', () => ({
  loadConfig: () => ({
    llmProvider: 'anthropic',
    llmModel: 'claude-sonnet-4-20250514',
    anthropicApiKey: 'test-key',
    byoak: {},
  }),
  getByoakValue: () => '',
}))

import { getSkill } from '../../../src/skills/index.js'
import '../../../src/skills/translate.js'

const ctx: any = { userId: 'u1', channelType: 'test', threadId: 't1', memories: [] }

describe('translate skills', () => {
  beforeEach(() => vi.clearAllMocks())

  describe('translate_text', () => {
    const skill = getSkill('translate_text')!

    it('translates text', async () => {
      mockChat.mockResolvedValue({ text: 'Hola mundo' })
      const res = await skill.handler({ text: 'Hello world', to: 'Spanish' }, ctx)
      expect(res.isError).toBe(false)
      expect(res.output).toBe('Hola mundo')
      expect(res.metadata?.to).toBe('Spanish')
    })

    it('passes tone parameter', async () => {
      mockChat.mockResolvedValue({ text: 'Bonjour' })
      const res = await skill.handler({ text: 'Hello', to: 'French', tone: 'formal' }, ctx)
      expect(res.metadata?.tone).toBe('formal')
      // Verify the prompt includes tone
      const callArgs = mockChat.mock.calls[0][0]
      expect(callArgs.messages[0].content).toContain('formal')
    })

    it('handles LLM errors', async () => {
      mockChat.mockRejectedValue(new Error('API rate limit'))
      const res = await skill.handler({ text: 'Hi', to: 'German' }, ctx)
      expect(res.isError).toBe(true)
      expect(res.output).toContain('API rate limit')
    })
  })

  describe('detect_language', () => {
    const skill = getSkill('detect_language')!

    it('detects language and returns JSON', async () => {
      mockChat.mockResolvedValue({ text: '{"language": "French", "code": "fr", "confidence": "high", "script": "Latin"}' })
      const res = await skill.handler({ text: 'Bonjour le monde' }, ctx)
      expect(res.isError).toBe(false)
      const parsed = JSON.parse(res.output)
      expect(parsed.language).toBe('French')
      expect(parsed.code).toBe('fr')
    })

    it('returns raw text if no JSON in response', async () => {
      mockChat.mockResolvedValue({ text: 'The text appears to be French' })
      const res = await skill.handler({ text: 'Bonjour' }, ctx)
      expect(res.output).toBe('The text appears to be French')
    })

    it('truncates input to 1000 chars', async () => {
      mockChat.mockResolvedValue({ text: '{"language": "English", "code": "en", "confidence": "high", "script": "Latin"}' })
      await skill.handler({ text: 'a'.repeat(2000) }, ctx)
      const prompt = mockChat.mock.calls[0][0].messages[0].content
      // The text in the prompt should be truncated
      expect(prompt.length).toBeLessThan(2000)
    })
  })

  describe('text_sentiment', () => {
    const skill = getSkill('text_sentiment')!

    it('analyzes basic sentiment', async () => {
      mockChat.mockResolvedValue({ text: '{"sentiment": "positive", "confidence": 0.95, "summary": "Very upbeat"}' })
      const res = await skill.handler({ text: 'I love this product!' }, ctx)
      expect(res.isError).toBe(false)
      const parsed = JSON.parse(res.output)
      expect(parsed.sentiment).toBe('positive')
    })

    it('uses detailed prompt when requested', async () => {
      mockChat.mockResolvedValue({ text: '{"sentiment": "mixed", "confidence": 0.7, "emotions": []}' })
      await skill.handler({ text: 'Good but could be better', detailed: true }, ctx)
      const prompt = mockChat.mock.calls[0][0].messages[0].content
      expect(prompt).toContain('Primary emotions')
    })
  })

  describe('text_entities', () => {
    const skill = getSkill('text_entities')!

    it('extracts named entities', async () => {
      mockChat.mockResolvedValue({ text: '{"entities": [{"text": "Google", "type": "organization", "context": "works at Google"}]}' })
      const res = await skill.handler({ text: 'She works at Google in Mountain View' }, ctx)
      expect(res.isError).toBe(false)
      const parsed = JSON.parse(res.output)
      expect(parsed.entities[0].type).toBe('organization')
    })

    it('passes entity type filter', async () => {
      mockChat.mockResolvedValue({ text: '{"entities": []}' })
      await skill.handler({ text: 'Some text', types: ['person', 'location'] }, ctx)
      const prompt = mockChat.mock.calls[0][0].messages[0].content
      expect(prompt).toContain('person, location')
    })
  })
})
