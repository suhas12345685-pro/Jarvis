import { describe, it, expect, beforeAll } from 'vitest'
import { writeFileSync, mkdirSync } from 'fs'
import { resolve } from 'path'
import { homedir } from 'os'
import type { AgentContext } from '../../../src/types/index.js'

const WORKSPACE = resolve(homedir(), 'jarvis-workspace')
mkdirSync(WORKSPACE, { recursive: true })

beforeAll(async () => {
  await import('../../../src/skills/dataAnalysis.js')

  // Write test fixtures
  writeFileSync(
    resolve(WORKSPACE, 'test-data.csv'),
    'name,age,score\nAlice,30,95\nBob,25,80\nCharlie,35,90\n'
  )
  writeFileSync(
    resolve(WORKSPACE, 'test-data.json'),
    JSON.stringify({ users: [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }] })
  )
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

describe('dataAnalysis skills', async () => {
  const { getSkill } = await import('../../../src/skills/index.js')

  it('parses CSV and returns correct row count', async () => {
    const skill = getSkill('data_analyze_csv')!
    const result = await skill.handler({ filePath: 'test-data.csv' }, mockCtx)
    expect(result.isError).toBe(false)
    expect(result.output).toContain('Total rows: 3')
    expect(result.output).toContain('name')
    expect(result.output).toContain('age')
    expect(result.output).toContain('score')
  })

  it('filters CSV rows by column value', async () => {
    const skill = getSkill('data_analyze_csv')!
    const result = await skill.handler(
      { filePath: 'test-data.csv', filterColumn: 'name', filterValue: 'Alice' },
      mockCtx
    )
    expect(result.isError).toBe(false)
    expect(result.output).toContain('Alice')
  })

  it('parses JSON and returns array info', async () => {
    const skill = getSkill('data_analyze_json')!
    const result = await skill.handler({ filePath: 'test-data.json', jsonPath: 'users' }, mockCtx)
    expect(result.isError).toBe(false)
    expect(result.output).toContain('2 items')
    expect(result.output).toContain('Alice')
  })

  it('blocks path traversal in CSV', async () => {
    const skill = getSkill('data_analyze_csv')!
    const result = await skill.handler({ filePath: '../../etc/passwd' }, mockCtx)
    expect(result.isError).toBe(true)
    expect(result.output).toContain('traversal')
  })
})
