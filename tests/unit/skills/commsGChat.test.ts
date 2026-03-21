import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock googleapis
const mockCreate = vi.fn().mockResolvedValue({ data: { name: 'spaces/ABC/messages/123' } })
const mockList = vi.fn().mockResolvedValue({ data: { spaces: [{ displayName: 'Test Space', name: 'spaces/ABC', type: 'ROOM' }] } })

vi.mock('googleapis', () => ({
  google: {
    auth: {
      GoogleAuth: vi.fn().mockImplementation(() => ({})),
    },
    chat: vi.fn().mockReturnValue({
      spaces: {
        messages: { create: mockCreate },
        list: mockList,
      },
    }),
  },
}))

// Mock config
vi.mock('../../../src/config.js', () => ({
  getByoakValue: vi.fn((byoak: any, provider: string, key: string) => {
    return byoak?.[`${provider}_${key}`] || null
  }),
}))

import { getSkill } from '../../../src/skills/index.js'
import '../../../src/skills/commsGChat.js'

describe('commsGChat skills', () => {
  beforeEach(() => vi.clearAllMocks())

  describe('gchat_send', () => {
    const skill = getSkill('gchat_send')!

    it('sends message to Google Chat space', async () => {
      const ctx: any = { byoak: { gchat_SERVICE_ACCOUNT_KEY: '{"type":"service_account"}' } }
      const res = await skill.handler({ spaceName: 'spaces/ABC', message: 'Hello!' }, ctx)
      expect(res.isError).toBe(false)
      expect(res.output).toContain('spaces/ABC')
      expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
        parent: 'spaces/ABC',
        requestBody: expect.objectContaining({ text: 'Hello!' }),
      }))
    })

    it('sends threaded reply', async () => {
      const ctx: any = { byoak: { gchat_SERVICE_ACCOUNT_KEY: '{"type":"service_account"}' } }
      await skill.handler({ spaceName: 'spaces/ABC', message: 'Reply', threadKey: 'thread-1' }, ctx)
      expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
        requestBody: expect.objectContaining({
          thread: { threadKey: 'thread-1' },
        }),
      }))
    })

    it('returns error when not configured', async () => {
      const ctx: any = { byoak: {} }
      const res = await skill.handler({ spaceName: 'spaces/ABC', message: 'test' }, ctx)
      expect(res.isError).toBe(true)
      expect(res.output).toContain('not configured')
    })
  })

  describe('gchat_list_spaces', () => {
    const skill = getSkill('gchat_list_spaces')!

    it('lists available spaces', async () => {
      const ctx: any = { byoak: { gchat_SERVICE_ACCOUNT_KEY: '{"type":"service_account"}' } }
      const res = await skill.handler({}, ctx)
      expect(res.isError).toBe(false)
      expect(res.output).toContain('Test Space')
    })

    it('handles empty spaces list', async () => {
      mockList.mockResolvedValueOnce({ data: { spaces: [] } })
      const ctx: any = { byoak: { gchat_SERVICE_ACCOUNT_KEY: '{"type":"service_account"}' } }
      const res = await skill.handler({}, ctx)
      expect(res.output).toContain('No spaces found')
    })
  })
})
