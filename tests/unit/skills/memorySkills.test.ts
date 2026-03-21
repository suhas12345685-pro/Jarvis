import { describe, it, expect, vi, beforeEach } from 'vitest'

import { getSkill } from '../../../src/skills/index.js'
import '../../../src/skills/memorySkills.js'

const now = new Date('2025-01-15T10:00:00Z')

const baseCtx: any = {
  userId: 'user-1',
  channelType: 'slack',
  threadId: 'thread-1',
  memories: [
    { content: 'User prefers dark mode', createdAt: now },
    { content: 'Project deadline is March 15', createdAt: now },
    { content: 'Favorite language is TypeScript', createdAt: now },
  ],
}

describe('memory skills', () => {
  describe('memory_store', () => {
    const skill = getSkill('memory_store')!

    it('formats content with default importance', async () => {
      const res = await skill.handler({ content: 'User likes coffee' }, baseCtx)
      expect(res.isError).toBe(false)
      expect(res.output).toBe('[Memory][medium] User likes coffee')
      expect(res.metadata?.action).toBe('store')
      expect(res.metadata?.importance).toBe('medium')
    })

    it('includes tags in output', async () => {
      const res = await skill.handler({ content: 'Prefers vim', tags: ['preference', 'editor'], importance: 'high' }, baseCtx)
      expect(res.output).toBe('[Memory][high][preference,editor] Prefers vim')
      expect(res.metadata?.tags).toEqual(['preference', 'editor'])
    })

    it('handles critical importance', async () => {
      const res = await skill.handler({ content: 'API key rotated', importance: 'critical' }, baseCtx)
      expect(res.output).toContain('[critical]')
    })
  })

  describe('memory_recall', () => {
    const skill = getSkill('memory_recall')!

    it('finds matching memories', async () => {
      const res = await skill.handler({ query: 'dark mode' }, baseCtx)
      expect(res.isError).toBe(false)
      expect(res.output).toContain('dark mode')
      expect(res.output).toContain('Found 1')
    })

    it('returns semantic matches when no exact match', async () => {
      const res = await skill.handler({ query: 'something unrelated xyz' }, baseCtx)
      expect(res.output).toContain('Semantic matches')
    })

    it('returns no memories found when ctx has no memories', async () => {
      const emptyCtx = { ...baseCtx, memories: [] }
      const res = await skill.handler({ query: 'anything' }, emptyCtx)
      expect(res.output).toContain('No memories found')
    })

    it('respects limit parameter', async () => {
      const ctx = {
        ...baseCtx,
        memories: [
          { content: 'test alpha item', createdAt: now },
          { content: 'test beta item', createdAt: now },
          { content: 'test gamma item', createdAt: now },
        ],
      }
      const res = await skill.handler({ query: 'test', limit: 2 }, ctx)
      expect(res.output).toContain('Found 2')
    })

    it('is case insensitive', async () => {
      const res = await skill.handler({ query: 'TYPESCRIPT' }, baseCtx)
      expect(res.output).toContain('TypeScript')
    })
  })

  describe('memory_context', () => {
    const skill = getSkill('memory_context')!

    it('shows user and channel info', async () => {
      const res = await skill.handler({}, baseCtx)
      expect(res.isError).toBe(false)
      expect(res.output).toContain('User: user-1')
      expect(res.output).toContain('Channel: slack')
      expect(res.output).toContain('Thread: thread-1')
      expect(res.output).toContain('Memories loaded: 3')
    })

    it('shows recent memories preview', async () => {
      const res = await skill.handler({}, baseCtx)
      expect(res.output).toContain('Recent memories')
      expect(res.output).toContain('dark mode')
    })

    it('handles no memories', async () => {
      const emptyCtx = { ...baseCtx, memories: [] }
      const res = await skill.handler({}, emptyCtx)
      expect(res.output).toContain('Memories loaded: 0')
      expect(res.output).not.toContain('Recent memories')
    })
  })
})
