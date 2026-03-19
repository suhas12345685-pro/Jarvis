/**
 * Network skills — DNS lookup, HTTP ping, SSL certificate check, port check.
 */
import { registerSkill } from './index.js'
import type { AgentContext, SkillResult } from '../types/index.js'
import { execSync } from 'child_process'
import * as dns from 'dns'
import * as net from 'net'
import * as tls from 'tls'
import { promisify } from 'util'

const dnsResolve = promisify(dns.resolve)
const dnsReverse = promisify(dns.reverse)

registerSkill({
  name: 'dns_lookup',
  description: 'Perform DNS lookups — resolve hostnames to IPs or reverse lookup.',
  inputSchema: {
    type: 'object',
    properties: {
      hostname: { type: 'string', description: 'Hostname to resolve (or IP for reverse lookup)' },
      type: { type: 'string', description: 'Record type: A, AAAA, MX, TXT, CNAME, NS, SOA, PTR (default: A)' },
    },
    required: ['hostname'],
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    try {
      const hostname = String(input.hostname)
      const recordType = String(input.type || 'A').toUpperCase()

      if (recordType === 'PTR') {
        const hostnames = await dnsReverse(hostname)
        return { output: JSON.stringify({ ip: hostname, hostnames }, null, 2), isError: false }
      }

      const records = await dnsResolve(hostname, recordType as any)
      return {
        output: JSON.stringify({ hostname, type: recordType, records }, null, 2),
        isError: false,
      }
    } catch (err) {
      return { output: `DNS lookup error: ${(err as Error).message}`, isError: true }
    }
  },
})

registerSkill({
  name: 'http_ping',
  description: 'Check if a URL is reachable and measure response time.',
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'URL to ping (e.g., https://example.com)' },
      method: { type: 'string', description: 'HTTP method (default: HEAD)' },
      timeout: { type: 'number', description: 'Timeout in milliseconds (default: 10000)' },
      follow_redirects: { type: 'boolean', description: 'Follow redirects (default: true)' },
    },
    required: ['url'],
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    try {
      const url = String(input.url)
      const method = String(input.method || 'HEAD').toUpperCase()
      const timeout = Number(input.timeout || 10000)

      const { default: axios } = await import('axios')
      const start = Date.now()

      const response = await axios({
        method: method as any,
        url,
        timeout,
        maxRedirects: input.follow_redirects === false ? 0 : 5,
        validateStatus: () => true,
      })

      const elapsed = Date.now() - start

      const result = {
        url,
        status: response.status,
        statusText: response.statusText,
        responseTime: `${elapsed}ms`,
        headers: {
          server: response.headers['server'],
          contentType: response.headers['content-type'],
          contentLength: response.headers['content-length'],
        },
        reachable: response.status < 500,
      }

      return { output: JSON.stringify(result, null, 2), isError: false }
    } catch (err) {
      const errMsg = (err as Error).message
      const isTimeout = errMsg.includes('timeout') || errMsg.includes('ETIMEDOUT')
      return {
        output: JSON.stringify({
          url: String(input.url),
          reachable: false,
          error: isTimeout ? 'Connection timed out' : errMsg,
        }, null, 2),
        isError: false, // Not a tool error — the unreachability is the result
      }
    }
  },
})

registerSkill({
  name: 'ssl_check',
  description: 'Check SSL/TLS certificate details for a hostname — expiry, issuer, validity.',
  inputSchema: {
    type: 'object',
    properties: {
      hostname: { type: 'string', description: 'Hostname to check (e.g., example.com)' },
      port: { type: 'number', description: 'Port number (default: 443)' },
    },
    required: ['hostname'],
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    const hostname = String(input.hostname).replace(/^https?:\/\//, '').split('/')[0]
    const port = Number(input.port || 443)

    return new Promise((resolve) => {
      const socket = tls.connect({ host: hostname, port, servername: hostname, rejectUnauthorized: false }, () => {
        const cert = socket.getPeerCertificate()
        socket.destroy()

        if (!cert || !cert.subject) {
          resolve({ output: 'No certificate returned', isError: true })
          return
        }

        const validFrom = new Date(cert.valid_from)
        const validTo = new Date(cert.valid_to)
        const now = new Date()
        const daysUntilExpiry = Math.floor((validTo.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))

        const result = {
          hostname,
          subject: cert.subject,
          issuer: cert.issuer,
          validFrom: validFrom.toISOString(),
          validTo: validTo.toISOString(),
          daysUntilExpiry,
          expired: daysUntilExpiry < 0,
          expiringSoon: daysUntilExpiry > 0 && daysUntilExpiry < 30,
          serialNumber: cert.serialNumber,
          fingerprint: cert.fingerprint256,
          protocol: socket.getProtocol(),
        }

        resolve({ output: JSON.stringify(result, null, 2), isError: false })
      })

      socket.on('error', (err) => {
        resolve({ output: `SSL check error: ${err.message}`, isError: true })
      })

      socket.setTimeout(10000, () => {
        socket.destroy()
        resolve({ output: 'SSL check timed out', isError: true })
      })
    })
  },
})

registerSkill({
  name: 'port_check',
  description: 'Check if a TCP port is open on a host.',
  inputSchema: {
    type: 'object',
    properties: {
      host: { type: 'string', description: 'Hostname or IP address' },
      port: { type: 'number', description: 'Port number to check' },
      timeout: { type: 'number', description: 'Timeout in milliseconds (default: 5000)' },
    },
    required: ['host', 'port'],
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    const host = String(input.host)
    const port = Number(input.port)
    const timeout = Number(input.timeout || 5000)

    return new Promise((resolve) => {
      const socket = new net.Socket()

      socket.setTimeout(timeout)

      socket.on('connect', () => {
        socket.destroy()
        resolve({
          output: JSON.stringify({ host, port, open: true, responseTime: 'connected' }, null, 2),
          isError: false,
        })
      })

      socket.on('timeout', () => {
        socket.destroy()
        resolve({
          output: JSON.stringify({ host, port, open: false, reason: 'timeout' }, null, 2),
          isError: false,
        })
      })

      socket.on('error', (err) => {
        resolve({
          output: JSON.stringify({ host, port, open: false, reason: err.message }, null, 2),
          isError: false,
        })
      })

      socket.connect(port, host)
    })
  },
})
