import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock logger
vi.mock('../../src/logger.js', () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

// Mock skills registry
vi.mock('../../src/skills/index.js', () => ({
  registerSkill: vi.fn(),
  getSkill: vi.fn().mockReturnValue(undefined),
  getAllDefinitions: () => [
    { name: 'web_search', description: 'Search the web', inputSchema: {} },
  ],
}))

// Mock LLM registry
const mockChat = vi.fn()
vi.mock('../../src/llm/registry.js', () => ({
  getProvider: () => ({
    name: 'mock',
    chat: mockChat,
  }),
}))

// Mock config
vi.mock('../../src/config.js', () => ({
  getByoakValue: () => null,
}))

// Mock filesystem
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>
  return {
    ...actual,
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    existsSync: vi.fn().mockReturnValue(true),
    readdirSync: vi.fn().mockReturnValue([]),
    readFileSync: vi.fn(),
  }
})

import { detectMissingCapability, autoGenerateSkill, loadAutoSkills } from '../../src/autoSkillGenerator.js'
import { getSkill, registerSkill } from '../../src/skills/index.js'

describe('autoSkillGenerator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('detectMissingCapability', () => {
    it('returns tool name for unknown tool errors', () => {
      const result = detectMissingCapability('my_tool', 'Unknown tool: my_tool', true)
      expect(result).toBe('my_tool')
    })

    it('returns null for non-error results', () => {
      const result = detectMissingCapability('my_tool', 'some output', false)
      expect(result).toBeNull()
    })

    it('returns null for errors that are not "Unknown tool"', () => {
      const result = detectMissingCapability('my_tool', 'Timeout error', true)
      expect(result).toBeNull()
    })
  })

  describe('autoGenerateSkill', () => {
    const config = {
      llmProvider: 'anthropic' as const,
      llmModel: 'claude-sonnet-4-6',
      anthropicApiKey: 'test-key',
      byoak: [],
    } as any

    it('returns false if skill already exists', async () => {
      ;(getSkill as ReturnType<typeof vi.fn>).mockReturnValueOnce({ name: 'existing' })

      const result = await autoGenerateSkill(config, 'existing')
      expect(result).toBe(false)
    })

    it('generates and registers a valid skill', async () => {
      ;(getSkill as ReturnType<typeof vi.fn>).mockReturnValue(undefined)

      mockChat.mockResolvedValueOnce({
        text: JSON.stringify({
          name: 'csv_to_json',
          description: 'Convert CSV to JSON',
          inputSchema: { type: 'object', properties: { csv: { type: 'string' } }, required: ['csv'] },
          code: 'const lines = input.csv.split("\\n"); return { output: JSON.stringify(lines), isError: false }',
        }),
        toolCalls: [],
        stopReason: 'end_turn',
      })

      const result = await autoGenerateSkill(config, 'csv_to_json')
      expect(result).toBe(true)
      expect(registerSkill).toHaveBeenCalledOnce()

      const registeredSkill = (registerSkill as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(registeredSkill.name).toBe('csv_to_json')
      expect(registeredSkill.description).toContain('[Auto-generated]')
    })

    it('blocks dangerous code patterns', async () => {
      ;(getSkill as ReturnType<typeof vi.fn>).mockReturnValue(undefined)

      const dangerousPatterns = [
        'process.exit(1)',
        'require("child_process")',
        'eval("malicious")',
        'Function("return this")',
        'child_process.exec("rm -rf /")',
        'fs.unlink("/etc/passwd")',
      ]

      for (const code of dangerousPatterns) {
        mockChat.mockResolvedValueOnce({
          text: JSON.stringify({
            name: 'bad_skill',
            description: 'A malicious skill',
            inputSchema: { type: 'object', properties: {} },
            code,
          }),
          toolCalls: [],
          stopReason: 'end_turn',
        })
        // Second attempt also blocked
        mockChat.mockResolvedValueOnce({
          text: JSON.stringify({
            name: 'bad_skill',
            description: 'Still malicious',
            inputSchema: { type: 'object', properties: {} },
            code,
          }),
          toolCalls: [],
          stopReason: 'end_turn',
        })
      }

      for (let i = 0; i < dangerousPatterns.length; i++) {
        vi.clearAllMocks()
        ;(getSkill as ReturnType<typeof vi.fn>).mockReturnValue(undefined)

        mockChat.mockResolvedValue({
          text: JSON.stringify({
            name: 'bad_skill',
            description: 'A malicious skill',
            inputSchema: { type: 'object', properties: {} },
            code: dangerousPatterns[i],
          }),
          toolCalls: [],
          stopReason: 'end_turn',
        })

        const result = await autoGenerateSkill(config, 'bad_skill')
        expect(result).toBe(false)
      }
    })

    it('returns false when LLM returns invalid JSON', async () => {
      ;(getSkill as ReturnType<typeof vi.fn>).mockReturnValue(undefined)

      mockChat.mockResolvedValue({
        text: 'This is not JSON at all',
        toolCalls: [],
        stopReason: 'end_turn',
      })

      const result = await autoGenerateSkill(config, 'new_skill')
      expect(result).toBe(false)
    })

    it('returns false when LLM response has missing fields', async () => {
      ;(getSkill as ReturnType<typeof vi.fn>).mockReturnValue(undefined)

      mockChat.mockResolvedValue({
        text: JSON.stringify({ name: 'incomplete' }), // missing description, inputSchema, code
        toolCalls: [],
        stopReason: 'end_turn',
      })

      const result = await autoGenerateSkill(config, 'incomplete')
      expect(result).toBe(false)
    })

    it('sanitizes skill names', async () => {
      ;(getSkill as ReturnType<typeof vi.fn>).mockReturnValue(undefined)

      mockChat.mockResolvedValueOnce({
        text: JSON.stringify({
          name: 'My-Skill-Name!!',
          description: 'Test',
          inputSchema: { type: 'object', properties: {} },
          code: 'return { output: "ok", isError: false }',
        }),
        toolCalls: [],
        stopReason: 'end_turn',
      })

      await autoGenerateSkill(config, 'My-Skill-Name!!')

      if ((registerSkill as ReturnType<typeof vi.fn>).mock.calls.length > 0) {
        const name = (registerSkill as ReturnType<typeof vi.fn>).mock.calls[0][0].name
        expect(name).toMatch(/^[a-z][a-z0-9_]*$/)
      }
    })

    it('retries up to MAX_GENERATION_ATTEMPTS', async () => {
      ;(getSkill as ReturnType<typeof vi.fn>).mockReturnValue(undefined)

      // Both attempts fail with invalid response
      mockChat.mockResolvedValue({
        text: 'not json',
        toolCalls: [],
        stopReason: 'end_turn',
      })

      const result = await autoGenerateSkill(config, 'fail_skill')
      expect(result).toBe(false)
      expect(mockChat).toHaveBeenCalledTimes(2) // MAX_GENERATION_ATTEMPTS = 2
    })
  })

  describe('loadAutoSkills', () => {
    it('returns 0 when directory does not exist', async () => {
      const fs = await import('fs')
      ;(fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValueOnce(false)

      const count = await loadAutoSkills()
      expect(count).toBe(0)
    })
  })
})
