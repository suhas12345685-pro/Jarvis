import axios from 'axios'
import { registerSkill } from './index.js'
import type { AgentContext, SkillResult } from '../types/index.js'
import { getByoakValue } from '../config.js'
import { validateUrl } from '../security.js'

registerSkill({
  name: 'web_search',
  description: 'Search the web using a search engine API and return results. Supports Google Custom Search and SerpAPI.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query string' },
      numResults: { type: 'number', description: 'Number of results to return (default: 5, max: 10)' },
      engine: {
        type: 'string',
        enum: ['google', 'serpapi'],
        description: 'Search engine to use (default: auto-detect from BYOAK)',
      },
    },
    required: ['query'],
  },
  handler: async (input: Record<string, unknown>, ctx: AgentContext): Promise<SkillResult> => {
    const query = String(input.query)
    const numResults = Math.min(Number(input.numResults ?? 5), 10)

    // Try SerpAPI first
    const serpApiKey = getByoakValue(ctx.byoak, 'serpapi', 'API_KEY')
    if (serpApiKey && (!input.engine || input.engine === 'serpapi')) {
      return searchSerpAPI(query, numResults, serpApiKey)
    }

    // Try Google Custom Search
    const googleApiKey = getByoakValue(ctx.byoak, 'google_search', 'API_KEY')
    const googleCx = getByoakValue(ctx.byoak, 'google_search', 'CX')
    if (googleApiKey && googleCx && (!input.engine || input.engine === 'google')) {
      return searchGoogle(query, numResults, googleApiKey, googleCx)
    }

    return {
      output: 'No search engine configured. Add BYOAK_SERPAPI_API_KEY or BYOAK_GOOGLE_SEARCH_API_KEY + BYOAK_GOOGLE_SEARCH_CX to .env',
      isError: true,
    }
  },
})

async function searchSerpAPI(query: string, num: number, apiKey: string): Promise<SkillResult> {
  try {
    const response = await axios.get('https://serpapi.com/search.json', {
      params: { q: query, num, api_key: apiKey, engine: 'google' },
      timeout: 15_000,
    })

    const results = (response.data.organic_results ?? []).slice(0, num) as Array<{
      title: string; link: string; snippet: string
    }>

    if (results.length === 0) {
      return { output: `No results found for: "${query}"`, isError: false }
    }

    const formatted = results.map((r, i) =>
      `${i + 1}. ${r.title}\n   ${r.link}\n   ${r.snippet}`
    ).join('\n\n')

    return { output: `Search results for "${query}":\n\n${formatted}`, isError: false }
  } catch (err) {
    return { output: `Search error: ${(err as Error).message}`, isError: true }
  }
}

async function searchGoogle(
  query: string, num: number, apiKey: string, cx: string
): Promise<SkillResult> {
  try {
    const response = await axios.get('https://www.googleapis.com/customsearch/v1', {
      params: { q: query, num, key: apiKey, cx },
      timeout: 15_000,
    })

    const items = (response.data.items ?? []).slice(0, num) as Array<{
      title: string; link: string; snippet: string
    }>

    if (items.length === 0) {
      return { output: `No results found for: "${query}"`, isError: false }
    }

    const formatted = items.map((r, i) =>
      `${i + 1}. ${r.title}\n   ${r.link}\n   ${r.snippet}`
    ).join('\n\n')

    return { output: `Search results for "${query}":\n\n${formatted}`, isError: false }
  } catch (err) {
    return { output: `Google search error: ${(err as Error).message}`, isError: true }
  }
}

registerSkill({
  name: 'web_scrape_text',
  description: 'Fetch a web page and extract its text content (no browser needed — uses HTTP + HTML parsing).',
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'URL to scrape' },
      selector: { type: 'string', description: 'Optional CSS-like hint for main content (e.g., "article", "main")' },
    },
    required: ['url'],
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    const url = String(input.url)

    const urlCheck = validateUrl(url)
    if (!urlCheck.valid) {
      return { output: `BLOCKED: ${urlCheck.error}`, isError: true }
    }

    try {
      const response = await axios.get(url, {
        timeout: 15_000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; JARVIS/1.0)',
          'Accept': 'text/html,application/xhtml+xml',
        },
        maxRedirects: 5,
      })

      const html = String(response.data)

      // Simple HTML to text extraction
      const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<nav[\s\S]*?<\/nav>/gi, '')
        .replace(/<footer[\s\S]*?<\/footer>/gi, '')
        .replace(/<header[\s\S]*?<\/header>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim()

      const truncated = text.length > 8000 ? text.slice(0, 8000) + '\n[truncated]' : text

      return { output: truncated, isError: false }
    } catch (err) {
      return { output: `Scrape error: ${(err as Error).message}`, isError: true }
    }
  },
})
