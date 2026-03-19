import { describe, it, expect, beforeAll } from 'vitest'
import type { AgentContext } from '../../../src/types/index.js'

beforeAll(async () => {
  await import('../../../src/skills/textTransform.js')
})

const mockCtx: AgentContext = {
  channelType: 'api',
  userId: 'test',
  threadId: 'test',
  rawMessage: '',
  memories: [],
  systemPrompt: '',
  byoak: [],
  sendInterim: async () => undefined,
  sendFinal: async () => {},
}

describe('textTransform skills', async () => {
  const { getSkill } = await import('../../../src/skills/index.js')

  describe('text_summarize', () => {
    it('summarizes long text', async () => {
      const skill = getSkill('text_summarize')!
      const text = [
        'The quick brown fox jumps over the lazy dog.',
        'This is a test sentence that is not very important.',
        'Machine learning is transforming how we process data.',
        'Natural language processing enables computers to understand text.',
        'The weather today is sunny and warm.',
        'Artificial intelligence continues to advance rapidly.',
        'Deep learning models require large amounts of training data.',
        'The stock market showed mixed results today.',
      ].join(' ')

      const result = await skill.handler({ text, maxSentences: 3 }, mockCtx)
      expect(result.isError).toBe(false)
      expect(result.output.length).toBeLessThan(text.length)
    })

    it('returns full text when under sentence limit', async () => {
      const skill = getSkill('text_summarize')!
      const text = 'Short text with one sentence.'
      const result = await skill.handler({ text, maxSentences: 5 }, mockCtx)
      expect(result.isError).toBe(false)
      expect(result.output).toContain('Short text')
    })

    it('errors on empty text', async () => {
      const skill = getSkill('text_summarize')!
      const result = await skill.handler({ text: '' }, mockCtx)
      expect(result.isError).toBe(true)
    })
  })

  describe('json_transform', () => {
    it('navigates dot notation path', async () => {
      const skill = getSkill('json_transform')!
      const data = { user: { name: 'Alice', age: 30 } }
      const result = await skill.handler({ data, path: 'user.name' }, mockCtx)
      expect(result.isError).toBe(false)
      expect(result.output).toBe('Alice')
    })

    it('handles array indexing', async () => {
      const skill = getSkill('json_transform')!
      const data = { items: ['a', 'b', 'c'] }
      const result = await skill.handler({ data, path: 'items[1]' }, mockCtx)
      expect(result.isError).toBe(false)
      expect(result.output).toBe('b')
    })

    it('handles array wildcard', async () => {
      const skill = getSkill('json_transform')!
      const data = { users: [{ name: 'Alice' }, { name: 'Bob' }] }
      const result = await skill.handler({ data, path: 'users[*]' }, mockCtx)
      expect(result.isError).toBe(false)
      expect(result.output).toContain('Alice')
      expect(result.output).toContain('Bob')
    })

    it('applies filter', async () => {
      const skill = getSkill('json_transform')!
      const data = { items: [{ type: 'fruit', name: 'apple' }, { type: 'veggie', name: 'carrot' }] }
      const result = await skill.handler({
        data,
        path: 'items[*]',
        filter: { key: 'type', value: 'fruit' },
      }, mockCtx)
      expect(result.isError).toBe(false)
      expect(result.output).toContain('apple')
      expect(result.output).not.toContain('carrot')
    })

    it('parses string JSON data', async () => {
      const skill = getSkill('json_transform')!
      const result = await skill.handler({
        data: '{"key": "value"}',
        path: 'key',
      }, mockCtx)
      expect(result.isError).toBe(false)
      expect(result.output).toBe('value')
    })

    it('errors on invalid JSON string', async () => {
      const skill = getSkill('json_transform')!
      const result = await skill.handler({ data: 'not-json', path: 'key' }, mockCtx)
      expect(result.isError).toBe(true)
    })
  })

  describe('text_regex', () => {
    it('finds matches', async () => {
      const skill = getSkill('text_regex')!
      const result = await skill.handler({
        text: 'My email is alice@example.com and bob@test.org',
        pattern: '[\\w.-]+@[\\w.-]+\\.\\w+',
      }, mockCtx)
      expect(result.isError).toBe(false)
      expect(result.output).toContain('2 match')
      expect(result.output).toContain('alice@example.com')
    })

    it('performs regex replace', async () => {
      const skill = getSkill('text_regex')!
      const result = await skill.handler({
        text: 'Hello World',
        pattern: 'World',
        replace: 'JARVIS',
      }, mockCtx)
      expect(result.isError).toBe(false)
      expect(result.output).toBe('Hello JARVIS')
    })

    it('reports no matches', async () => {
      const skill = getSkill('text_regex')!
      const result = await skill.handler({ text: 'hello', pattern: 'xyz' }, mockCtx)
      expect(result.isError).toBe(false)
      expect(result.output).toContain('No matches')
    })

    it('handles invalid regex gracefully', async () => {
      const skill = getSkill('text_regex')!
      const result = await skill.handler({ text: 'test', pattern: '[invalid' }, mockCtx)
      expect(result.isError).toBe(true)
      expect(result.output).toContain('Regex error')
    })
  })
})
