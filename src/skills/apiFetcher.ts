import axios from 'axios'
import { registerSkill } from './index.js'
import type { AgentContext, SkillResult } from '../types/index.js'
import { getByoakValue } from '../config.js'

registerSkill({
  name: 'api_fetch',
  description: 'Make a REST API request (GET, POST, PUT, DELETE, PATCH) and return the response. Supports BYOAK header injection for authenticated APIs.',
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Full URL to request' },
      method: {
        type: 'string',
        enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
        description: 'HTTP method (default: GET)',
      },
      headers: {
        type: 'object',
        description: 'Additional request headers as key-value pairs',
        additionalProperties: { type: 'string' },
      },
      body: {
        description: 'Request body (for POST/PUT/PATCH)',
      },
      byoakService: {
        type: 'string',
        description: 'Optional BYOAK service name to inject its API key as Authorization Bearer header',
      },
      byoakKeyName: {
        type: 'string',
        description: 'Key name within the BYOAK service (default: API_KEY)',
      },
    },
    required: ['url'],
  },
  handler: async (input: Record<string, unknown>, ctx: AgentContext): Promise<SkillResult> => {
    const url = String(input.url)
    const method = String(input.method ?? 'GET').toUpperCase()
    const headers: Record<string, string> = (input.headers as Record<string, string>) ?? {}

    // Inject BYOAK key if requested
    if (input.byoakService) {
      const keyName = String(input.byoakKeyName ?? 'API_KEY')
      const key = getByoakValue(ctx.byoak, String(input.byoakService), keyName)
      if (key) {
        headers['Authorization'] = `Bearer ${key}`
      }
    }

    try {
      const response = await axios({
        url,
        method,
        headers,
        data: input.body,
        timeout: 30_000,
        validateStatus: () => true, // Return response even on 4xx/5xx
      })

      const body = typeof response.data === 'string'
        ? response.data
        : JSON.stringify(response.data, null, 2)

      const truncated = body.length > 8000 ? body.slice(0, 8000) + '\n[truncated]' : body
      const isError = response.status >= 400

      return {
        output: `HTTP ${response.status} ${response.statusText}\n\n${truncated}`,
        isError,
        metadata: { status: response.status },
      }
    } catch (err) {
      return { output: `Request error: ${(err as Error).message}`, isError: true }
    }
  },
})

registerSkill({
  name: 'graphql_query',
  description: 'Execute a GraphQL query against an endpoint.',
  inputSchema: {
    type: 'object',
    properties: {
      endpoint: { type: 'string', description: 'GraphQL endpoint URL' },
      query: { type: 'string', description: 'GraphQL query string' },
      variables: { type: 'object', description: 'Query variables' },
      byoakService: { type: 'string', description: 'BYOAK service for auth token' },
    },
    required: ['endpoint', 'query'],
  },
  handler: async (input: Record<string, unknown>, ctx: AgentContext): Promise<SkillResult> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }

    if (input.byoakService) {
      const key = getByoakValue(ctx.byoak, String(input.byoakService), 'API_KEY')
      if (key) headers['Authorization'] = `Bearer ${key}`
    }

    try {
      const response = await axios.post(
        String(input.endpoint),
        { query: input.query, variables: input.variables ?? {} },
        { headers, timeout: 30_000 }
      )

      if (response.data?.errors) {
        return {
          output: `GraphQL errors: ${JSON.stringify(response.data.errors, null, 2)}`,
          isError: true,
        }
      }

      return {
        output: JSON.stringify(response.data?.data ?? response.data, null, 2).slice(0, 8000),
        isError: false,
      }
    } catch (err) {
      return { output: `GraphQL error: ${(err as Error).message}`, isError: true }
    }
  },
})
