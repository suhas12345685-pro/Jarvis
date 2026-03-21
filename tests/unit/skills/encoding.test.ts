import { describe, it, expect, beforeAll } from 'vitest'
import type { AgentContext } from '../../../src/types/index.js'

beforeAll(async () => {
  await import('../../../src/skills/encoding.js')
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

describe('encoding skills', async () => {
  const { getSkill } = await import('../../../src/skills/index.js')

  describe('encode_base64', () => {
    it('encodes text to base64', async () => {
      const skill = getSkill('encode_base64')!
      const result = await skill.handler({ text: 'Hello World' }, mockCtx)
      expect(result.isError).toBe(false)
      expect(result.output).toBe(Buffer.from('Hello World').toString('base64'))
    })

    it('decodes base64 to text', async () => {
      const skill = getSkill('encode_base64')!
      const encoded = Buffer.from('Hello World').toString('base64')
      const result = await skill.handler({ text: encoded, decode: true }, mockCtx)
      expect(result.isError).toBe(false)
      expect(result.output).toBe('Hello World')
    })
  })

  describe('encode_url', () => {
    it('encodes URL special characters', async () => {
      const skill = getSkill('encode_url')!
      const result = await skill.handler({ text: 'hello world & foo=bar' }, mockCtx)
      expect(result.isError).toBe(false)
      expect(result.output).toBe('hello%20world%20%26%20foo%3Dbar')
    })

    it('decodes URL encoded string', async () => {
      const skill = getSkill('encode_url')!
      const result = await skill.handler({ text: 'hello%20world', decode: true }, mockCtx)
      expect(result.isError).toBe(false)
      expect(result.output).toBe('hello world')
    })
  })

  describe('encode_jwt_decode', () => {
    it('decodes a valid JWT', async () => {
      const skill = getSkill('encode_jwt_decode')!
      // Create a simple JWT
      const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
      const payload = Buffer.from(JSON.stringify({ sub: '123', name: 'Test' })).toString('base64url')
      const token = `${header}.${payload}.signature`

      const result = await skill.handler({ token }, mockCtx)
      expect(result.isError).toBe(false)
      expect(result.output).toContain('HS256')
      expect(result.output).toContain('Test')
    })

    it('rejects invalid JWT format', async () => {
      const skill = getSkill('encode_jwt_decode')!
      const result = await skill.handler({ token: 'not.a.valid.jwt.token' }, mockCtx)
      expect(result.isError).toBe(true)
    })

    it('shows expiry info for expired tokens', async () => {
      const skill = getSkill('encode_jwt_decode')!
      const header = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url')
      const payload = Buffer.from(JSON.stringify({ exp: 1000000 })).toString('base64url')
      const token = `${header}.${payload}.sig`

      const result = await skill.handler({ token }, mockCtx)
      expect(result.output).toContain('EXPIRED')
    })
  })

  describe('encode_html', () => {
    it('encodes HTML entities', async () => {
      const skill = getSkill('encode_html')!
      const result = await skill.handler({ text: '<script>alert("xss")</script>' }, mockCtx)
      expect(result.isError).toBe(false)
      expect(result.output).toContain('&lt;script&gt;')
      expect(result.output).toContain('&quot;')
    })

    it('decodes HTML entities', async () => {
      const skill = getSkill('encode_html')!
      const result = await skill.handler({ text: '&lt;b&gt;bold&lt;/b&gt;', decode: true }, mockCtx)
      expect(result.output).toBe('<b>bold</b>')
    })
  })

  describe('encode_json_format', () => {
    it('formats JSON', async () => {
      const skill = getSkill('encode_json_format')!
      const result = await skill.handler({ json: '{"a":1,"b":2}' }, mockCtx)
      expect(result.isError).toBe(false)
      expect(result.output).toContain('  "a": 1')
    })

    it('minifies JSON', async () => {
      const skill = getSkill('encode_json_format')!
      const result = await skill.handler({ json: '{ "a": 1, "b": 2 }', action: 'minify' }, mockCtx)
      expect(result.output).toBe('{"a":1,"b":2}')
    })

    it('validates valid JSON', async () => {
      const skill = getSkill('encode_json_format')!
      const result = await skill.handler({ json: '{"key":"value"}', action: 'validate' }, mockCtx)
      expect(result.isError).toBe(false)
      expect(result.output).toContain('Valid JSON')
    })

    it('reports invalid JSON on validate', async () => {
      const skill = getSkill('encode_json_format')!
      const result = await skill.handler({ json: '{bad json}', action: 'validate' }, mockCtx)
      expect(result.isError).toBe(true)
      expect(result.output).toContain('Invalid JSON')
    })
  })
})
