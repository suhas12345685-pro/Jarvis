import { registerSkill } from './index.js'
import type { AgentContext, SkillResult } from '../types/index.js'

registerSkill({
  name: 'text_summarize',
  description: 'Summarize text by extracting key sentences. Uses extractive summarization (no LLM call).',
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Text to summarize' },
      maxSentences: { type: 'number', description: 'Maximum number of sentences in summary (default: 5)' },
    },
    required: ['text'],
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    const text = String(input.text)
    const maxSentences = Number(input.maxSentences ?? 5)

    if (!text.trim()) {
      return { output: 'No text provided to summarize', isError: true }
    }

    // Split into sentences
    const sentences = text
      .replace(/([.!?])\s+/g, '$1\n')
      .split('\n')
      .map(s => s.trim())
      .filter(s => s.length > 10) // Skip very short fragments

    if (sentences.length <= maxSentences) {
      return { output: sentences.join(' '), isError: false }
    }

    // Score sentences by word frequency importance
    const wordFreq = new Map<string, number>()
    const words = text.toLowerCase().match(/\b\w{3,}\b/g) ?? []
    for (const w of words) {
      wordFreq.set(w, (wordFreq.get(w) ?? 0) + 1)
    }

    // Stop words to ignore
    const stopWords = new Set([
      'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had',
      'her', 'was', 'one', 'our', 'out', 'has', 'have', 'been', 'that', 'this',
      'with', 'they', 'from', 'will', 'would', 'there', 'their', 'what', 'about',
      'which', 'when', 'make', 'like', 'just', 'over', 'such', 'also', 'into',
      'than', 'them', 'very', 'some', 'more', 'most',
    ])

    const scored = sentences.map((sentence, idx) => {
      const sWords = sentence.toLowerCase().match(/\b\w{3,}\b/g) ?? []
      const score = sWords.reduce((sum, w) => {
        if (stopWords.has(w)) return sum
        return sum + (wordFreq.get(w) ?? 0)
      }, 0) / Math.max(sWords.length, 1)
      // Boost first and last sentences slightly
      const positionBoost = idx === 0 ? 1.5 : idx === sentences.length - 1 ? 1.2 : 1
      return { sentence, score: score * positionBoost, idx }
    })

    // Select top sentences, keeping original order
    scored.sort((a, b) => b.score - a.score)
    const selected = scored.slice(0, maxSentences)
    selected.sort((a, b) => a.idx - b.idx)

    const summary = selected.map(s => s.sentence).join(' ')
    return { output: summary, isError: false }
  },
})

registerSkill({
  name: 'json_transform',
  description: 'Transform JSON data using a jq-like path expression. Supports dot notation, array indexing, and filtering.',
  inputSchema: {
    type: 'object',
    properties: {
      data: { description: 'JSON data (string or object)' },
      path: { type: 'string', description: 'Dot-notation path (e.g., "users[0].name", "items[*].price")' },
      filter: {
        type: 'object',
        description: 'Optional filter: { "key": "fieldName", "value": "matchValue" }',
        properties: {
          key: { type: 'string' },
          value: { type: 'string' },
        },
      },
    },
    required: ['data', 'path'],
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    let data: unknown
    try {
      data = typeof input.data === 'string' ? JSON.parse(input.data as string) : input.data
    } catch {
      return { output: 'Invalid JSON data', isError: true }
    }

    const path = String(input.path)

    try {
      let result = navigatePath(data, path)

      // Apply filter if provided
      const filter = input.filter as { key?: string; value?: string } | undefined
      if (filter?.key && Array.isArray(result)) {
        result = result.filter(item => {
          if (typeof item !== 'object' || item === null) return false
          return String((item as Record<string, unknown>)[filter.key!]) === String(filter.value)
        })
      }

      const output = typeof result === 'string' ? result : JSON.stringify(result, null, 2)
      const truncated = output.length > 8000 ? output.slice(0, 8000) + '\n[truncated]' : output
      return { output: truncated, isError: false }
    } catch (err) {
      return { output: `Transform error: ${(err as Error).message}`, isError: true }
    }
  },
})

function navigatePath(data: unknown, path: string): unknown {
  if (!path || path === '.') return data

  const segments = path.split(/\.(?![^[]*\])/) // Split on dots not inside brackets

  let current: unknown = data

  for (const segment of segments) {
    if (current === null || current === undefined) return undefined

    // Handle array wildcard: items[*]
    const wildcardMatch = segment.match(/^(\w+)\[\*\]$/)
    if (wildcardMatch) {
      const key = wildcardMatch[1]
      const arr = (current as Record<string, unknown>)[key]
      if (!Array.isArray(arr)) return undefined
      current = arr
      continue
    }

    // Handle array index: items[0]
    const indexMatch = segment.match(/^(\w+)\[(\d+)\]$/)
    if (indexMatch) {
      const key = indexMatch[1]
      const idx = parseInt(indexMatch[2], 10)
      const arr = (current as Record<string, unknown>)[key]
      if (!Array.isArray(arr)) return undefined
      current = arr[idx]
      continue
    }

    // Regular key navigation
    if (typeof current === 'object' && current !== null) {
      current = (current as Record<string, unknown>)[segment]
    } else {
      return undefined
    }
  }

  return current
}

registerSkill({
  name: 'text_regex',
  description: 'Apply a regex pattern to text and return matches.',
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Input text to search' },
      pattern: { type: 'string', description: 'Regular expression pattern' },
      flags: { type: 'string', description: 'Regex flags (default: "gi")' },
      replace: { type: 'string', description: 'Optional replacement string (if provided, performs replace instead of match)' },
    },
    required: ['text', 'pattern'],
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    const text = String(input.text)
    const pattern = String(input.pattern)
    const flags = String(input.flags ?? 'gi')

    try {
      const regex = new RegExp(pattern, flags)

      if (input.replace !== undefined) {
        const result = text.replace(regex, String(input.replace))
        return { output: result.slice(0, 8000), isError: false }
      }

      const matches = [...text.matchAll(new RegExp(pattern, flags.includes('g') ? flags : flags + 'g'))]
      if (matches.length === 0) {
        return { output: 'No matches found', isError: false }
      }

      const output = matches.map((m, i) => {
        const groups = m.groups ? ` | groups: ${JSON.stringify(m.groups)}` : ''
        return `${i + 1}. "${m[0]}" at index ${m.index}${groups}`
      }).join('\n')

      return { output: `Found ${matches.length} match(es):\n${output}`, isError: false }
    } catch (err) {
      return { output: `Regex error: ${(err as Error).message}`, isError: true }
    }
  },
})
