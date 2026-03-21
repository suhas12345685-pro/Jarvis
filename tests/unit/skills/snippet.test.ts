import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { AgentContext } from '../../../src/types/index.js'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const SNIPPETS_DIR = join(homedir(), '.jarvis', 'snippets')

beforeAll(async () => {
  mkdirSync(SNIPPETS_DIR, { recursive: true })
  await import('../../../src/skills/snippet.js')
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

describe('snippet skills', async () => {
  const { getSkill } = await import('../../../src/skills/index.js')
  const testSnippetName = `test-snippet-${Date.now()}`

  afterAll(() => {
    // Cleanup test snippet
    try {
      rmSync(join(SNIPPETS_DIR, `${testSnippetName}.json`))
    } catch { /* already deleted */ }
  })

  describe('snippet_save', () => {
    it('saves a snippet', async () => {
      const skill = getSkill('snippet_save')!
      const result = await skill.handler({
        name: testSnippetName,
        code: 'console.log("hello")',
        language: 'javascript',
        description: 'Test snippet',
        tags: ['test', 'hello'],
      }, mockCtx)

      expect(result.isError).toBe(false)
      expect(result.output).toContain(testSnippetName)
      expect(result.output).toContain('saved')
    })

    it('sanitizes snippet names', async () => {
      const skill = getSkill('snippet_save')!
      const result = await skill.handler({
        name: 'test/../evil',
        code: 'echo hi',
        language: 'bash',
      }, mockCtx)

      expect(result.isError).toBe(false)
      // Name should be sanitized (no path traversal)
      expect(result.output).not.toContain('..')
    })
  })

  describe('snippet_get', () => {
    it('retrieves a saved snippet', async () => {
      const skill = getSkill('snippet_get')!
      const result = await skill.handler({ name: testSnippetName }, mockCtx)

      expect(result.isError).toBe(false)
      expect(result.output).toContain('console.log("hello")')
      expect(result.output).toContain('javascript')
    })

    it('returns error for nonexistent snippet', async () => {
      const skill = getSkill('snippet_get')!
      const result = await skill.handler({ name: 'nonexistent-snippet-xyz' }, mockCtx)
      expect(result.isError).toBe(true)
      expect(result.output).toContain('not found')
    })
  })

  describe('snippet_search', () => {
    it('finds snippets by query', async () => {
      const skill = getSkill('snippet_search')!
      const result = await skill.handler({ query: testSnippetName }, mockCtx)

      expect(result.isError).toBe(false)
      expect(result.output).toContain(testSnippetName)
    })

    it('finds snippets by language', async () => {
      const skill = getSkill('snippet_search')!
      const result = await skill.handler({ language: 'javascript' }, mockCtx)

      expect(result.isError).toBe(false)
      // Should find at least our test snippet
    })

    it('returns no results for bad query', async () => {
      const skill = getSkill('snippet_search')!
      const result = await skill.handler({ query: 'zzz-nonexistent-query-zzz' }, mockCtx)
      expect(result.output).toContain('No snippets found')
    })
  })

  describe('snippet_run', () => {
    it('runs a bash snippet', async () => {
      // First save a simple bash snippet
      const save = getSkill('snippet_save')!
      const runName = `test-run-${Date.now()}`
      await save.handler({ name: runName, code: 'echo "hello from snippet"', language: 'bash' }, mockCtx)

      const run = getSkill('snippet_run')!
      const result = await run.handler({ name: runName }, mockCtx)

      expect(result.isError).toBe(false)
      expect(result.output).toContain('hello from snippet')

      // Cleanup
      const del = getSkill('snippet_delete')!
      await del.handler({ name: runName }, mockCtx)
    })

    it('blocks dangerous snippets', async () => {
      const save = getSkill('snippet_save')!
      const dangerName = `test-danger-${Date.now()}`
      await save.handler({ name: dangerName, code: 'rm -rf /', language: 'bash' }, mockCtx)

      const run = getSkill('snippet_run')!
      const result = await run.handler({ name: dangerName }, mockCtx)

      expect(result.isError).toBe(true)
      expect(result.output).toContain('BLOCKED')

      // Cleanup
      const del = getSkill('snippet_delete')!
      await del.handler({ name: dangerName }, mockCtx)
    })

    it('returns error for nonexistent snippet', async () => {
      const run = getSkill('snippet_run')!
      const result = await run.handler({ name: 'nonexistent-xyz' }, mockCtx)
      expect(result.isError).toBe(true)
    })
  })

  describe('snippet_delete', () => {
    it('deletes a snippet', async () => {
      const save = getSkill('snippet_save')!
      const delName = `test-delete-${Date.now()}`
      await save.handler({ name: delName, code: 'test', language: 'bash' }, mockCtx)

      const del = getSkill('snippet_delete')!
      const result = await del.handler({ name: delName }, mockCtx)

      expect(result.isError).toBe(false)
      expect(result.output).toContain('deleted')

      // Verify it's gone
      const get = getSkill('snippet_get')!
      const getResult = await get.handler({ name: delName }, mockCtx)
      expect(getResult.isError).toBe(true)
    })

    it('returns error for nonexistent snippet', async () => {
      const del = getSkill('snippet_delete')!
      const result = await del.handler({ name: 'nonexistent-xyz' }, mockCtx)
      expect(result.isError).toBe(true)
    })
  })
})
