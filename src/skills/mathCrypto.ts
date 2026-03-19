import { registerSkill } from './index.js'
import type { AgentContext, SkillResult } from '../types/index.js'
import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'crypto'

registerSkill({
  name: 'math_evaluate',
  description: 'Evaluate a mathematical expression safely. Supports basic arithmetic, powers, sqrt, trig functions.',
  inputSchema: {
    type: 'object',
    properties: {
      expression: { type: 'string', description: 'Math expression (e.g., "2 * (3 + 4)", "sqrt(144)", "sin(pi/2)")' },
    },
    required: ['expression'],
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    const expr = String(input.expression)

    // Whitelist allowed characters/functions
    const sanitized = expr
      .replace(/pi/gi, String(Math.PI))
      .replace(/e(?![a-z])/gi, String(Math.E))
      .replace(/sqrt/g, 'Math.sqrt')
      .replace(/abs/g, 'Math.abs')
      .replace(/ceil/g, 'Math.ceil')
      .replace(/floor/g, 'Math.floor')
      .replace(/round/g, 'Math.round')
      .replace(/sin/g, 'Math.sin')
      .replace(/cos/g, 'Math.cos')
      .replace(/tan/g, 'Math.tan')
      .replace(/log/g, 'Math.log')
      .replace(/pow/g, 'Math.pow')
      .replace(/min/g, 'Math.min')
      .replace(/max/g, 'Math.max')

    // Block anything that's not math
    if (/[a-zA-Z_$](?!ath\.)/.test(sanitized.replace(/Math\.\w+/g, ''))) {
      return { output: 'Expression contains non-math characters', isError: true }
    }

    try {
      const fn = new Function(`"use strict"; return (${sanitized})`)
      const result = fn()
      return { output: String(result), isError: false }
    } catch (err) {
      return { output: `Math error: ${(err as Error).message}`, isError: true }
    }
  },
})

registerSkill({
  name: 'math_unit_convert',
  description: 'Convert between common units (length, weight, temperature, data, time).',
  inputSchema: {
    type: 'object',
    properties: {
      value: { type: 'number', description: 'Value to convert' },
      from: { type: 'string', description: 'Source unit (e.g., "km", "lb", "celsius", "GB", "hours")' },
      to: { type: 'string', description: 'Target unit' },
    },
    required: ['value', 'from', 'to'],
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    const value = Number(input.value)
    const from = String(input.from).toLowerCase()
    const to = String(input.to).toLowerCase()

    const conversions: Record<string, Record<string, number>> = {
      // Length (base: meters)
      m: { km: 0.001, cm: 100, mm: 1000, in: 39.3701, ft: 3.28084, yd: 1.09361, mi: 0.000621371 },
      km: { m: 1000, cm: 100000, mm: 1e6, in: 39370.1, ft: 3280.84, yd: 1093.61, mi: 0.621371 },
      cm: { m: 0.01, km: 1e-5, mm: 10, in: 0.393701, ft: 0.0328084 },
      in: { cm: 2.54, m: 0.0254, ft: 1 / 12, mm: 25.4 },
      ft: { m: 0.3048, cm: 30.48, in: 12, yd: 1 / 3, mi: 1 / 5280 },
      mi: { km: 1.60934, m: 1609.34, ft: 5280, yd: 1760 },
      // Weight (base: kg)
      kg: { lb: 2.20462, oz: 35.274, g: 1000, mg: 1e6, ton: 0.001 },
      lb: { kg: 0.453592, oz: 16, g: 453.592 },
      g: { kg: 0.001, lb: 0.00220462, oz: 0.035274, mg: 1000 },
      oz: { g: 28.3495, kg: 0.0283495, lb: 0.0625 },
      // Data (base: bytes)
      b: { kb: 1 / 1024, mb: 1 / (1024 ** 2), gb: 1 / (1024 ** 3), tb: 1 / (1024 ** 4) },
      kb: { b: 1024, mb: 1 / 1024, gb: 1 / (1024 ** 2), tb: 1 / (1024 ** 3) },
      mb: { b: 1024 ** 2, kb: 1024, gb: 1 / 1024, tb: 1 / (1024 ** 2) },
      gb: { b: 1024 ** 3, kb: 1024 ** 2, mb: 1024, tb: 1 / 1024 },
      tb: { b: 1024 ** 4, kb: 1024 ** 3, mb: 1024 ** 2, gb: 1024 },
      // Time (base: seconds)
      seconds: { minutes: 1 / 60, hours: 1 / 3600, days: 1 / 86400, weeks: 1 / 604800 },
      minutes: { seconds: 60, hours: 1 / 60, days: 1 / 1440, weeks: 1 / 10080 },
      hours: { seconds: 3600, minutes: 60, days: 1 / 24, weeks: 1 / 168 },
      days: { seconds: 86400, minutes: 1440, hours: 24, weeks: 1 / 7 },
    }

    // Temperature special handling
    if ((from === 'celsius' || from === 'c') && (to === 'fahrenheit' || to === 'f')) {
      return { output: `${value}°C = ${(value * 9 / 5 + 32).toFixed(2)}°F`, isError: false }
    }
    if ((from === 'fahrenheit' || from === 'f') && (to === 'celsius' || to === 'c')) {
      return { output: `${value}°F = ${((value - 32) * 5 / 9).toFixed(2)}°C`, isError: false }
    }
    if ((from === 'celsius' || from === 'c') && (to === 'kelvin' || to === 'k')) {
      return { output: `${value}°C = ${(value + 273.15).toFixed(2)}K`, isError: false }
    }
    if ((from === 'kelvin' || from === 'k') && (to === 'celsius' || to === 'c')) {
      return { output: `${value}K = ${(value - 273.15).toFixed(2)}°C`, isError: false }
    }

    const fromMap = conversions[from]
    if (fromMap && fromMap[to] !== undefined) {
      const result = value * fromMap[to]
      return { output: `${value} ${from} = ${result.toFixed(6).replace(/\.?0+$/, '')} ${to}`, isError: false }
    }

    return { output: `Cannot convert from "${from}" to "${to}". Supported: length (m,km,cm,in,ft,mi), weight (kg,lb,g,oz), data (b,kb,mb,gb,tb), time (seconds,minutes,hours,days), temperature (c,f,k).`, isError: true }
  },
})

registerSkill({
  name: 'crypto_hash',
  description: 'Generate a hash (SHA-256, SHA-512, MD5) of input text.',
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Text to hash' },
      algorithm: { type: 'string', enum: ['sha256', 'sha512', 'md5', 'sha1'], description: 'Hash algorithm (default: sha256)' },
    },
    required: ['text'],
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    const text = String(input.text)
    const algo = String(input.algorithm ?? 'sha256')
    const hash = createHash(algo).update(text).digest('hex')
    return { output: `${algo.toUpperCase()}: ${hash}`, isError: false }
  },
})

registerSkill({
  name: 'crypto_random',
  description: 'Generate cryptographically secure random values (hex, base64, UUID, password).',
  inputSchema: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['hex', 'base64', 'uuid', 'password'],
        description: 'Type of random value (default: hex)',
      },
      length: { type: 'number', description: 'Length in bytes for hex/base64 (default: 32), or characters for password (default: 16)' },
    },
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    const type = String(input.type ?? 'hex')
    const length = Number(input.length ?? (type === 'password' ? 16 : 32))

    switch (type) {
      case 'hex':
        return { output: randomBytes(length).toString('hex'), isError: false }
      case 'base64':
        return { output: randomBytes(length).toString('base64'), isError: false }
      case 'uuid':
        return { output: crypto.randomUUID(), isError: false }
      case 'password': {
        const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+-='
        const bytes = randomBytes(length)
        const password = Array.from(bytes).map(b => chars[b % chars.length]).join('')
        return { output: password, isError: false }
      }
      default:
        return { output: `Unknown type: ${type}`, isError: true }
    }
  },
})

registerSkill({
  name: 'crypto_encrypt',
  description: 'Encrypt text using AES-256-GCM.',
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Text to encrypt' },
      key: { type: 'string', description: 'Encryption key (will be hashed to 32 bytes)' },
    },
    required: ['text', 'key'],
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    const text = String(input.text)
    const keyHash = createHash('sha256').update(String(input.key)).digest()
    const iv = randomBytes(16)
    const cipher = createCipheriv('aes-256-gcm', keyHash, iv)
    let encrypted = cipher.update(text, 'utf8', 'hex')
    encrypted += cipher.final('hex')
    const authTag = cipher.getAuthTag().toString('hex')
    return {
      output: `${iv.toString('hex')}:${authTag}:${encrypted}`,
      isError: false,
    }
  },
})

registerSkill({
  name: 'crypto_decrypt',
  description: 'Decrypt text encrypted with crypto_encrypt (AES-256-GCM).',
  inputSchema: {
    type: 'object',
    properties: {
      encrypted: { type: 'string', description: 'Encrypted string (iv:authTag:ciphertext)' },
      key: { type: 'string', description: 'Decryption key (same as encryption key)' },
    },
    required: ['encrypted', 'key'],
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    try {
      const parts = String(input.encrypted).split(':')
      if (parts.length !== 3) return { output: 'Invalid encrypted format (expected iv:authTag:ciphertext)', isError: true }

      const [ivHex, authTagHex, ciphertext] = parts
      const keyHash = createHash('sha256').update(String(input.key)).digest()
      const iv = Buffer.from(ivHex, 'hex')
      const authTag = Buffer.from(authTagHex, 'hex')
      const decipher = createDecipheriv('aes-256-gcm', keyHash, iv)
      decipher.setAuthTag(authTag)
      let decrypted = decipher.update(ciphertext, 'hex', 'utf8')
      decrypted += decipher.final('utf8')
      return { output: decrypted, isError: false }
    } catch (err) {
      return { output: `Decryption failed: ${(err as Error).message}`, isError: true }
    }
  },
})
