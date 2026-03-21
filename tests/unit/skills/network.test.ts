import { describe, it, expect, vi, beforeAll } from 'vitest'
import type { AgentContext } from '../../../src/types/index.js'

// Mock dns module
vi.mock('dns', () => ({
  resolve: vi.fn((hostname: string, type: string, cb: Function) => {
    if (hostname === 'example.com') {
      cb(null, type === 'MX' ? [{ exchange: 'mail.example.com', priority: 10 }] : ['93.184.216.34'])
    } else {
      cb(new Error('ENOTFOUND'))
    }
  }),
  reverse: vi.fn((ip: string, cb: Function) => {
    if (ip === '93.184.216.34') {
      cb(null, ['example.com'])
    } else {
      cb(new Error('ENOTFOUND'))
    }
  }),
}))

// Mock net module
vi.mock('net', () => {
  const EventEmitter = require('events')
  return {
    Socket: vi.fn().mockImplementation(() => {
      const socket = new EventEmitter()
      socket.setTimeout = vi.fn()
      socket.connect = vi.fn((port: number, host: string) => {
        if (port === 80) {
          setTimeout(() => socket.emit('connect'), 10)
        } else if (port === 99999) {
          setTimeout(() => socket.emit('error', new Error('ECONNREFUSED')), 10)
        } else {
          setTimeout(() => socket.emit('timeout'), 10)
        }
      })
      socket.destroy = vi.fn()
      return socket
    }),
  }
})

// Mock tls module
vi.mock('tls', () => {
  const EventEmitter = require('events')
  return {
    connect: vi.fn((_opts: any, cb: Function) => {
      const socket = new EventEmitter()
      socket.getPeerCertificate = vi.fn().mockReturnValue({
        subject: { CN: 'example.com' },
        issuer: { O: 'Let\'s Encrypt' },
        valid_from: '2024-01-01',
        valid_to: '2025-12-31',
        serialNumber: 'ABC123',
        fingerprint256: 'AA:BB:CC',
      })
      socket.getProtocol = vi.fn().mockReturnValue('TLSv1.3')
      socket.destroy = vi.fn()
      socket.setTimeout = vi.fn()
      setTimeout(() => cb(), 10)
      return socket
    }),
  }
})

// Mock axios for http_ping
vi.mock('axios', () => ({
  default: vi.fn().mockResolvedValue({
    status: 200,
    statusText: 'OK',
    headers: {
      server: 'nginx',
      'content-type': 'text/html',
      'content-length': '1234',
    },
  }),
}))

beforeAll(async () => {
  await import('../../../src/skills/network.js')
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

describe('network skills', async () => {
  const { getSkill } = await import('../../../src/skills/index.js')

  describe('dns_lookup', () => {
    it('resolves A records', async () => {
      const skill = getSkill('dns_lookup')!
      const result = await skill.handler({ hostname: 'example.com' }, mockCtx)

      expect(result.isError).toBe(false)
      const parsed = JSON.parse(result.output)
      expect(parsed.hostname).toBe('example.com')
      expect(parsed.type).toBe('A')
      expect(parsed.records).toContain('93.184.216.34')
    })

    it('handles DNS errors', async () => {
      const skill = getSkill('dns_lookup')!
      const result = await skill.handler({ hostname: 'nonexistent.invalid' }, mockCtx)

      expect(result.isError).toBe(true)
      expect(result.output).toContain('DNS lookup error')
    })

    it('performs reverse lookup', async () => {
      const skill = getSkill('dns_lookup')!
      const result = await skill.handler({ hostname: '93.184.216.34', type: 'PTR' }, mockCtx)

      expect(result.isError).toBe(false)
      const parsed = JSON.parse(result.output)
      expect(parsed.hostnames).toContain('example.com')
    })
  })

  describe('http_ping', () => {
    it('pings a reachable URL', async () => {
      const skill = getSkill('http_ping')!
      const result = await skill.handler({ url: 'https://example.com' }, mockCtx)

      expect(result.isError).toBe(false)
      const parsed = JSON.parse(result.output)
      expect(parsed.status).toBe(200)
      expect(parsed.reachable).toBe(true)
    })

    it('handles unreachable URLs', async () => {
      const axios = (await import('axios')).default as unknown as ReturnType<typeof vi.fn>
      axios.mockRejectedValueOnce(new Error('ECONNREFUSED'))

      const skill = getSkill('http_ping')!
      const result = await skill.handler({ url: 'https://unreachable.test' }, mockCtx)

      expect(result.isError).toBe(false) // Unreachability is a result, not an error
      const parsed = JSON.parse(result.output)
      expect(parsed.reachable).toBe(false)
    })
  })

  describe('ssl_check', () => {
    it('checks SSL certificate', async () => {
      const skill = getSkill('ssl_check')!
      const result = await skill.handler({ hostname: 'example.com' }, mockCtx)

      expect(result.isError).toBe(false)
      const parsed = JSON.parse(result.output)
      expect(parsed.hostname).toBe('example.com')
      expect(parsed.subject).toBeTruthy()
      expect(parsed.protocol).toBe('TLSv1.3')
    })
  })

  describe('port_check', () => {
    it('detects open port', async () => {
      const skill = getSkill('port_check')!
      const result = await skill.handler({ host: 'example.com', port: 80 }, mockCtx)

      expect(result.isError).toBe(false)
      const parsed = JSON.parse(result.output)
      expect(parsed.open).toBe(true)
    })

    it('detects refused port', async () => {
      const skill = getSkill('port_check')!
      const result = await skill.handler({ host: 'example.com', port: 99999 }, mockCtx)

      expect(result.isError).toBe(false)
      const parsed = JSON.parse(result.output)
      expect(parsed.open).toBe(false)
    })
  })
})
