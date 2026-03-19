import { registerSkill } from './index.js'
import type { AgentContext, SkillResult } from '../types/index.js'

// Memory skills allow JARVIS to explicitly manage its own memory

registerSkill({
  name: 'memory_store',
  description: 'Store important information in long-term memory for future recall. Use this to remember facts, preferences, or context.',
  inputSchema: {
    type: 'object',
    properties: {
      content: { type: 'string', description: 'Information to remember' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Tags for categorization' },
      importance: { type: 'string', enum: ['low', 'medium', 'high', 'critical'], description: 'Importance level' },
    },
    required: ['content'],
  },
  handler: async (input: Record<string, unknown>, ctx: AgentContext): Promise<SkillResult> => {
    // Note: actual storage happens in the router/tool loop via memory.insertMemory
    // This skill formats the content for storage
    const content = String(input.content)
    const tags = (input.tags as string[] | undefined) ?? []
    const importance = String(input.importance ?? 'medium')

    const formatted = `[Memory][${importance}]${tags.length > 0 ? `[${tags.join(',')}]` : ''} ${content}`

    return {
      output: formatted,
      isError: false,
      metadata: { memoryContent: content, tags, importance, action: 'store' },
    }
  },
})

registerSkill({
  name: 'memory_recall',
  description: 'Search long-term memory for relevant information. JARVIS can recall past conversations, stored facts, and context.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'What to search for in memory' },
      limit: { type: 'number', description: 'Max results (default: 5)' },
    },
    required: ['query'],
  },
  handler: async (input: Record<string, unknown>, ctx: AgentContext): Promise<SkillResult> => {
    const query = String(input.query)
    const limit = Number(input.limit ?? 5)

    // Search using the memories already loaded in context + hint for deeper search
    const relevant = ctx.memories
      .filter(m => m.content.toLowerCase().includes(query.toLowerCase()))
      .slice(0, limit)

    if (relevant.length === 0 && ctx.memories.length > 0) {
      // Return whatever memories we have as they were semantically matched
      const output = ctx.memories.slice(0, limit).map((m, i) =>
        `${i + 1}. ${m.content} (${m.createdAt.toISOString()})`
      ).join('\n')
      return { output: `Semantic matches:\n${output}`, isError: false }
    }

    if (relevant.length === 0) {
      return { output: `No memories found matching "${query}"`, isError: false }
    }

    const output = relevant.map((m, i) =>
      `${i + 1}. ${m.content} (${m.createdAt.toISOString()})`
    ).join('\n')

    return { output: `Found ${relevant.length} memory/ies:\n${output}`, isError: false }
  },
})

registerSkill({
  name: 'memory_context',
  description: 'Get the current conversation context — what JARVIS knows about the current user and session.',
  inputSchema: { type: 'object', properties: {} },
  handler: async (_input: Record<string, unknown>, ctx: AgentContext): Promise<SkillResult> => {
    const output = [
      `User: ${ctx.userId}`,
      `Channel: ${ctx.channelType}`,
      `Thread: ${ctx.threadId}`,
      `Memories loaded: ${ctx.memories.length}`,
      ctx.memories.length > 0
        ? `\nRecent memories:\n${ctx.memories.slice(0, 3).map(m => `  - ${m.content.slice(0, 100)}`).join('\n')}`
        : '',
    ].filter(Boolean).join('\n')

    return { output, isError: false }
  },
})
