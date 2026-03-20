import { registerSkill } from './index.js'
import type { AgentContext, SkillResult } from '../types/index.js'

registerSkill({
  name: 'encode_base64',
  description: 'Encode or decode Base64 text.',
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Text to encode/decode' },
      decode: { type: 'boolean', description: 'If true, decode from Base64 instead of encoding' },
    },
    required: ['text'],
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    const text = String(input.text)
    if (input.decode) {
      try {
        return { output: Buffer.from(text, 'base64').toString('utf-8'), isError: false }
      } catch {
        return { output: 'Invalid Base64 input', isError: true }
      }
    }
    return { output: Buffer.from(text).toString('base64'), isError: false }
  },
})

registerSkill({
  name: 'encode_url',
  description: 'URL encode or decode a string.',
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Text to encode/decode' },
      decode: { type: 'boolean', description: 'If true, decode instead of encoding' },
    },
    required: ['text'],
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    const text = String(input.text)
    try {
      const result = input.decode ? decodeURIComponent(text) : encodeURIComponent(text)
      return { output: result, isError: false }
    } catch (err) {
      return { output: `Encoding error: ${(err as Error).message}`, isError: true }
    }
  },
})

registerSkill({
  name: 'encode_jwt_decode',
  description: 'Decode a JWT token (without verification) to inspect its payload and header.',
  inputSchema: {
    type: 'object',
    properties: {
      token: { type: 'string', description: 'JWT token string' },
    },
    required: ['token'],
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    const token = String(input.token)
    const parts = token.split('.')

    if (parts.length !== 3) {
      return { output: 'Invalid JWT format (expected 3 dot-separated parts)', isError: true }
    }

    try {
      const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString())
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString())

      // Check expiry
      let expiryInfo = ''
      if (payload.exp) {
        const expDate = new Date(payload.exp * 1000)
        const isExpired = expDate < new Date()
        expiryInfo = `\nExpires: ${expDate.toISOString()} (${isExpired ? 'EXPIRED' : 'valid'})`
      }

      return {
        output: `Header:\n${JSON.stringify(header, null, 2)}\n\nPayload:\n${JSON.stringify(payload, null, 2)}${expiryInfo}`,
        isError: false,
      }
    } catch {
      return { output: 'Failed to decode JWT payload', isError: true }
    }
  },
})

registerSkill({
  name: 'encode_html',
  description: 'Encode or decode HTML entities.',
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Text to encode/decode' },
      decode: { type: 'boolean', description: 'If true, decode HTML entities' },
    },
    required: ['text'],
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    const text = String(input.text)
    if (input.decode) {
      const decoded = text
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
      return { output: decoded, isError: false }
    }
    const encoded = text
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
    return { output: encoded, isError: false }
  },
})

registerSkill({
  name: 'encode_json_format',
  description: 'Format, minify, or validate JSON.',
  inputSchema: {
    type: 'object',
    properties: {
      json: { type: 'string', description: 'JSON string' },
      action: { type: 'string', enum: ['format', 'minify', 'validate'], description: 'Action (default: format)' },
      indent: { type: 'number', description: 'Indent spaces for formatting (default: 2)' },
    },
    required: ['json'],
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    const jsonStr = String(input.json)
    const action = String(input.action ?? 'format')
    const indent = Number(input.indent ?? 2)

    try {
      const parsed = JSON.parse(jsonStr)

      switch (action) {
        case 'minify':
          return { output: JSON.stringify(parsed), isError: false }
        case 'validate':
          return { output: `Valid JSON. Type: ${Array.isArray(parsed) ? 'array' : typeof parsed}. Keys: ${typeof parsed === 'object' && parsed !== null ? Object.keys(parsed).length : 'N/A'}`, isError: false }
        default:
          return { output: JSON.stringify(parsed, null, indent), isError: false }
      }
    } catch (err) {
      if (action === 'validate') {
        return { output: `Invalid JSON: ${(err as Error).message}`, isError: true }
      }
      return { output: `JSON parse error: ${(err as Error).message}`, isError: true }
    }
  },
})
