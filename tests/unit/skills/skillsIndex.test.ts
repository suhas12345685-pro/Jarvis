import { describe, it, expect } from 'vitest'
import { registerSkill, getSkill, getAllDefinitions, toLLMTools } from '../../../src/skills/index.js'

describe('skills/index registry', () => {
  it('registers and retrieves a skill', () => {
    registerSkill({
      name: 'test_registry_skill',
      description: 'A test skill',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => ({ output: 'ok', isError: false }),
    })

    const skill = getSkill('test_registry_skill')
    expect(skill).toBeDefined()
    expect(skill!.name).toBe('test_registry_skill')
    expect(skill!.description).toBe('A test skill')
  })

  it('returns undefined for non-existent skill', () => {
    expect(getSkill('definitely_does_not_exist_xyz')).toBeUndefined()
  })

  it('getAllDefinitions returns all registered skills', () => {
    const all = getAllDefinitions()
    expect(all.length).toBeGreaterThan(0)
    const names = all.map(s => s.name)
    expect(names).toContain('test_registry_skill')
  })

  it('toLLMTools converts skills to LLM tool format', () => {
    const tools = toLLMTools()
    expect(tools.length).toBeGreaterThan(0)
    const tool = tools.find(t => t.name === 'test_registry_skill')
    expect(tool).toBeDefined()
    expect(tool!.description).toBe('A test skill')
    expect(tool!.inputSchema).toBeDefined()
    // Should not have handler property
    expect((tool as any).handler).toBeUndefined()
  })

  it('overwrites skill with same name', () => {
    registerSkill({
      name: 'test_registry_skill',
      description: 'Updated description',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => ({ output: 'updated', isError: false }),
    })

    const skill = getSkill('test_registry_skill')
    expect(skill!.description).toBe('Updated description')
  })
})
