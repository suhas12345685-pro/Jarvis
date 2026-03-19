import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import type { AgentContext } from '../../../src/types/index.js'

beforeAll(async () => {
  await import('../../../src/skills/apiFetcher.js')
})

const mockCtx: AgentContext = {
  channelType: 'api',
  userId: 'test',
  threadId: 'test',
  rawMessage: '',
  memories: [],
  systemPrompt: '',
  byoak: [{ service: 'myapi', keyName: 'API_KEY', value: 'secret-123' }],
  sendInterim: async () => undefined,
  sendFinal: async () => {},
}

vi.mock('axios', () => ({
  default: vi.fn().mockImplementation(async (config: { url: string; headers?: Record<string, string> }) => ({
    status: 200,
    statusText: 'OK',
    data: { url: config.url, headers: config.headers ?? {} },
  })),
}))

describe('apiFetcher skills', async () => {
  const { getSkill } = await import('../../../src/skills/index.js')

  it('makes a GET request and returns response', async () => {
    const skill = getSkill('api_fetch')!
    const result = await skill.handler({ url: 'https://example.com/api' }, mockCtx)
    expect(result.isError).toBe(false)
    expect(result.output).toContain('HTTP 200')
  })

  it('injects BYOAK key as Authorization header', async () => {
    const axios = (await import('axios')).default as ReturnType<typeof vi.fn>
    axios.mockImplementationOnce(async (config: { headers?: Record<string, string> }) => ({
      status: 200,
      statusText: 'OK',
      data: { receivedHeaders: config.headers },
    }))

    const skill = getSkill('api_fetch')!
    await skill.handler(
      { url: 'https://api.example.com', byoakService: 'myapi', byoakKeyName: 'API_KEY' },
      mockCtx
    )

    expect(axios).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer secret-123' }),
      })
    )
  })

  it('marks 4xx responses as errors', async () => {
    const axios = (await import('axios')).default as ReturnType<typeof vi.fn>
    axios.mockResolvedValueOnce({
      status: 404,
      statusText: 'Not Found',
      data: { error: 'not found' },
    })

    const skill = getSkill('api_fetch')!
    const result = await skill.handler({ url: 'https://example.com/missing' }, mockCtx)
    expect(result.isError).toBe(true)
    expect(result.output).toContain('404')
  })
})
