import { describe, it, expect, beforeAll } from 'vitest'
import type { AgentContext } from '../../../src/types/index.js'
import { randomUUID } from 'crypto'

beforeAll(async () => {
  await import('../../../src/skills/localFileOps.js')
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

describe('localFileOps skills', async () => {
  const { getSkill } = await import('../../../src/skills/index.js')

  it('writes and reads a file', async () => {
    const name = `test-${randomUUID()}.txt`
    const content = 'Hello JARVIS'

    const write = getSkill('file_write')!
    const read = getSkill('file_read')!

    const writeResult = await write.handler({ path: name, content }, mockCtx)
    expect(writeResult.isError).toBe(false)

    const readResult = await read.handler({ path: name }, mockCtx)
    expect(readResult.isError).toBe(false)
    expect(readResult.output).toBe(content)
  })

  it('blocks path traversal with ../', async () => {
    const read = getSkill('file_read')!
    const result = await read.handler({ path: '../../etc/passwd' }, mockCtx)
    expect(result.isError).toBe(true)
    expect(result.output).toContain('traversal')
  })

  it('appends to a file', async () => {
    const name = `append-${randomUUID()}.txt`
    const write = getSkill('file_write')!
    const append = getSkill('file_append')!
    const read = getSkill('file_read')!

    await write.handler({ path: name, content: 'Line 1\n' }, mockCtx)
    await append.handler({ path: name, content: 'Line 2\n' }, mockCtx)

    const result = await read.handler({ path: name }, mockCtx)
    expect(result.output).toContain('Line 1')
    expect(result.output).toContain('Line 2')
  })

  it('lists files in workspace', async () => {
    const list = getSkill('file_list')!
    const result = await list.handler({}, mockCtx)
    expect(result.isError).toBe(false)
  })

  it('searches file contents by regex', async () => {
    const name = `search-${randomUUID()}.txt`
    const write = getSkill('file_write')!
    await write.handler({ path: name, content: 'JARVIS is awesome\nNothing here' }, mockCtx)

    const search = getSkill('file_search')!
    const result = await search.handler({ pattern: 'JARVIS' }, mockCtx)
    expect(result.isError).toBe(false)
    expect(result.output).toContain('JARVIS')
  })
})
