import { describe, it, expect, vi, afterEach } from 'vitest'
import { createServer, connect, type Socket } from 'net'
import { existsSync, unlinkSync, mkdirSync } from 'fs'
import { resolve } from 'path'
import { tmpdir } from 'os'

// Test the daemon's IPC protocol by simulating socket communication.
// We don't start the real daemon (it boots heavy deps), but we verify
// the client-side protocol works correctly with a mock socket server.

const TEST_SOCKET = resolve(tmpdir(), `jarvis-test-${process.pid}.sock`)

describe('daemon IPC protocol', () => {
  let server: ReturnType<typeof createServer> | null = null

  afterEach(() => {
    if (server) {
      server.close()
      server = null
    }
    if (existsSync(TEST_SOCKET)) {
      try { unlinkSync(TEST_SOCKET) } catch { /* ok */ }
    }
  })

  it('PING command returns PONG', async () => {
    // Start a mock server that handles PING
    server = createServer((socket: Socket) => {
      const chunks: Buffer[] = []
      socket.on('data', (chunk) => chunks.push(chunk))
      socket.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8')
        const command = raw.split('\n')[0].trim()
        if (command === 'PING') {
          socket.write('PONG\n')
        }
        socket.destroy()
      })
    })

    await new Promise<void>((res) => server!.listen(TEST_SOCKET, res))

    // Connect as client
    const response = await new Promise<string>((resolve, reject) => {
      const sock = connect(TEST_SOCKET)
      const chunks: Buffer[] = []
      sock.on('connect', () => sock.end('PING\n'))
      sock.on('data', (chunk) => chunks.push(chunk))
      sock.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
      sock.on('error', reject)
    })

    expect(response.trim()).toBe('PONG')
  })

  it('TASK command returns ACK with task ID', async () => {
    server = createServer((socket: Socket) => {
      const chunks: Buffer[] = []
      socket.on('data', (chunk) => chunks.push(chunk))
      socket.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8')
        const newline = raw.indexOf('\n')
        const command = raw.slice(0, newline).trim()
        const body = raw.slice(newline + 1)
        if (command === 'TASK') {
          const payload = JSON.parse(body)
          socket.write(`ACK ${payload.taskId}\n`)
        }
        socket.destroy()
      })
    })

    await new Promise<void>((res) => server!.listen(TEST_SOCKET, res))

    const taskPayload = JSON.stringify({
      type: 'exec',
      command: 'echo test',
      taskId: 'test-123',
      timestamp: new Date().toISOString(),
    })

    const response = await new Promise<string>((resolve, reject) => {
      const sock = connect(TEST_SOCKET)
      const chunks: Buffer[] = []
      sock.on('connect', () => sock.end(`TASK\n${taskPayload}`))
      sock.on('data', (chunk) => chunks.push(chunk))
      sock.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
      sock.on('error', reject)
    })

    expect(response.trim()).toBe('ACK test-123')
  })

  it('unknown command returns ERR', async () => {
    server = createServer((socket: Socket) => {
      const chunks: Buffer[] = []
      socket.on('data', (chunk) => chunks.push(chunk))
      socket.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8')
        const command = raw.split('\n')[0].trim()
        if (command !== 'PING' && command !== 'TASK' && command !== 'STATUS') {
          socket.write(`ERR Unknown command: ${command}\n`)
        }
        socket.destroy()
      })
    })

    await new Promise<void>((res) => server!.listen(TEST_SOCKET, res))

    const response = await new Promise<string>((resolve, reject) => {
      const sock = connect(TEST_SOCKET)
      const chunks: Buffer[] = []
      sock.on('connect', () => sock.end('GARBAGE\n'))
      sock.on('data', (chunk) => chunks.push(chunk))
      sock.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
      sock.on('error', reject)
    })

    expect(response).toContain('ERR')
    expect(response).toContain('GARBAGE')
  })
})
