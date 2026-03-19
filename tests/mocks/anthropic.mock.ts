import { vi } from 'vitest'

export const mockCreate = vi.fn()
export const mockModelsList = vi.fn().mockResolvedValue({ data: [{ id: 'claude-sonnet-4-6' }] })

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
    models: { list: mockModelsList },
  })),
}))

export function mockEndTurn(text: string) {
  mockCreate.mockResolvedValueOnce({
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
  })
}

export function mockToolUse(toolName: string, input: Record<string, unknown>, thenText: string) {
  mockCreate
    .mockResolvedValueOnce({
      content: [{ type: 'tool_use', id: 'tu_test', name: toolName, input }],
      stop_reason: 'tool_use',
    })
    .mockResolvedValueOnce({
      content: [{ type: 'text', text: thenText }],
      stop_reason: 'end_turn',
    })
}
