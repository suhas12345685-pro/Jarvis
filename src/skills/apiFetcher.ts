import axios from 'axios'
import { registerSkill } from './index.js'
import type { AgentContext, SkillResult } from '../types/index.js'
import { getByoakValue } from '../config.js'
import { validateUrl, validateHeaders } from '../security.js'

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

    // SSRF protection — block internal/private URLs
    const urlCheck = validateUrl(url)
    if (!urlCheck.valid) {
      return { output: `BLOCKED: ${urlCheck.error}`, isError: true }
    }

    // Header injection protection
    const headerCheck = validateHeaders(headers)
    if (!headerCheck.valid) {
      return { output: `BLOCKED: ${headerCheck.error}`, isError: true }
    }

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
        maxRedirects: 5,
        validateStatus: () => true, // Return response even on 4xx/5xx
      })

      // Validate redirect target for SSRF
      const finalUrl = response.request?.res?.responseUrl as string | undefined
      if (finalUrl && finalUrl !== url) {
        const redirectCheck = validateUrl(finalUrl)
        if (!redirectCheck.valid) {
          return { output: `BLOCKED: Redirect to blocked URL: ${redirectCheck.error}`, isError: true }
        }
      }

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
    const endpoint = String(input.endpoint)
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }

    // SSRF protection
    const urlCheck = validateUrl(endpoint)
    if (!urlCheck.valid) {
      return { output: `BLOCKED: ${urlCheck.error}`, isError: true }
    }

    if (input.byoakService) {
      const key = getByoakValue(ctx.byoak, String(input.byoakService), 'API_KEY')
      if (key) headers['Authorization'] = `Bearer ${key}`
    }

    try {
      const response = await axios.post(
        endpoint,
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
