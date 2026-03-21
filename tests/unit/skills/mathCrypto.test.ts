import { describe, it, expect, beforeAll } from 'vitest'
import type { AgentContext } from '../../../src/types/index.js'

beforeAll(async () => {
  await import('../../../src/skills/mathCrypto.js')
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

describe('mathCrypto skills', async () => {
  const { getSkill } = await import('../../../src/skills/index.js')

  describe('math_evaluate', () => {
    it('evaluates basic arithmetic', async () => {
      const skill = getSkill('math_evaluate')!
      const result = await skill.handler({ expression: '2 * (3 + 4)' }, mockCtx)
      expect(result.isError).toBe(false)
      expect(result.output).toBe('14')
    })

    it('evaluates sqrt', async () => {
      const skill = getSkill('math_evaluate')!
      const result = await skill.handler({ expression: 'sqrt(144)' }, mockCtx)
      expect(result.output).toBe('12')
    })

    it('blocks non-math characters', async () => {
      const skill = getSkill('math_evaluate')!
      const result = await skill.handler({ expression: 'process.exit()' }, mockCtx)
      expect(result.isError).toBe(true)
    })
  })

  describe('math_unit_convert', () => {
    it('converts km to miles', async () => {
      const skill = getSkill('math_unit_convert')!
      const result = await skill.handler({ value: 10, from: 'km', to: 'mi' }, mockCtx)
      expect(result.isError).toBe(false)
      expect(result.output).toContain('6.21371')
    })

    it('converts celsius to fahrenheit', async () => {
      const skill = getSkill('math_unit_convert')!
      const result = await skill.handler({ value: 100, from: 'celsius', to: 'fahrenheit' }, mockCtx)
      expect(result.output).toContain('212')
    })

    it('converts GB to MB', async () => {
      const skill = getSkill('math_unit_convert')!
      const result = await skill.handler({ value: 1, from: 'gb', to: 'mb' }, mockCtx)
      expect(result.output).toContain('1024')
    })

    it('reports unsupported conversion', async () => {
      const skill = getSkill('math_unit_convert')!
      const result = await skill.handler({ value: 1, from: 'bananas', to: 'apples' }, mockCtx)
      expect(result.isError).toBe(true)
    })
  })

  describe('crypto_hash', () => {
    it('generates SHA-256 hash', async () => {
      const skill = getSkill('crypto_hash')!
      const result = await skill.handler({ text: 'hello' }, mockCtx)
      expect(result.isError).toBe(false)
      expect(result.output).toContain('SHA256')
      expect(result.output).toMatch(/[a-f0-9]{64}/)
    })

    it('generates MD5 hash', async () => {
      const skill = getSkill('crypto_hash')!
      const result = await skill.handler({ text: 'hello', algorithm: 'md5' }, mockCtx)
      expect(result.output).toContain('MD5')
    })
  })

  describe('crypto_random', () => {
    it('generates hex string', async () => {
      const skill = getSkill('crypto_random')!
      const result = await skill.handler({ type: 'hex', length: 16 }, mockCtx)
      expect(result.isError).toBe(false)
      expect(result.output).toMatch(/^[a-f0-9]+$/)
    })

    it('generates UUID', async () => {
      const skill = getSkill('crypto_random')!
      const result = await skill.handler({ type: 'uuid' }, mockCtx)
      expect(result.output).toMatch(/^[a-f0-9-]{36}$/)
    })

    it('generates password', async () => {
      const skill = getSkill('crypto_random')!
      const result = await skill.handler({ type: 'password', length: 20 }, mockCtx)
      expect(result.output.length).toBe(20)
    })
  })

  describe('crypto_encrypt/decrypt', () => {
    it('encrypts and decrypts text roundtrip', async () => {
      const encrypt = getSkill('crypto_encrypt')!
      const decrypt = getSkill('crypto_decrypt')!

      const encResult = await encrypt.handler({ text: 'secret message', key: 'mykey' }, mockCtx)
      expect(encResult.isError).toBe(false)
      expect(encResult.output).toContain(':') // iv:authTag:ciphertext

      const decResult = await decrypt.handler({ encrypted: encResult.output, key: 'mykey' }, mockCtx)
      expect(decResult.isError).toBe(false)
      expect(decResult.output).toBe('secret message')
    })

    it('fails decryption with wrong key', async () => {
      const encrypt = getSkill('crypto_encrypt')!
      const decrypt = getSkill('crypto_decrypt')!

      const encResult = await encrypt.handler({ text: 'secret', key: 'key1' }, mockCtx)
      const decResult = await decrypt.handler({ encrypted: encResult.output, key: 'wrongkey' }, mockCtx)
      expect(decResult.isError).toBe(true)
    })

    it('rejects invalid encrypted format', async () => {
      const decrypt = getSkill('crypto_decrypt')!
      const result = await decrypt.handler({ encrypted: 'not-valid', key: 'key' }, mockCtx)
      expect(result.isError).toBe(true)
    })
  })
})
