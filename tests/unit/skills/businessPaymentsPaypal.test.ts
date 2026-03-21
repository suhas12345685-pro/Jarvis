import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock axios
const { mockAxiosPost, mockAxiosGet } = vi.hoisted(() => ({
  mockAxiosPost: vi.fn(),
  mockAxiosGet: vi.fn(),
}))
vi.mock('axios', () => ({ default: { post: mockAxiosPost, get: mockAxiosGet } }))

// Mock PayPal SDK — provide properties the code accesses so vitest doesn't throw
vi.mock('@paypal/paypal-server-sdk', () => ({
  Environment: undefined,
  PayPalHttpClient: undefined,
  OrdersCreateRequest: undefined,
  OrdersCaptureRequest: undefined,
  default: {
    Environment: undefined,
    PayPalHttpClient: undefined,
    OrdersCreateRequest: undefined,
    OrdersCaptureRequest: undefined,
  },
}))

// Mock config
vi.mock('../../../src/config.js', () => ({
  getByoakValue: vi.fn((byoak: any, provider: string, key: string) => {
    return byoak?.[`${provider}_${key}`] || null
  }),
}))

import { getSkill } from '../../../src/skills/index.js'
import '../../../src/skills/businessPaymentsPaypal.js'

const configuredCtx: any = { byoak: { paypal_CLIENT_ID: 'client-id', paypal_CLIENT_SECRET: 'client-secret' } }

describe('businessPaymentsPaypal skills', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAxiosPost.mockResolvedValue({ data: { access_token: 'test-token' } })
  })

  describe('paypal_create_order', () => {
    const skill = getSkill('paypal_create_order')!

    it('creates a PayPal order via API', async () => {
      mockAxiosPost
        .mockResolvedValueOnce({ data: { access_token: 'token' } })
        .mockResolvedValueOnce({
          data: { id: 'ORDER-123', status: 'CREATED', links: [{ rel: 'approve', href: 'https://paypal.com/approve' }] },
        })
      const res = await skill.handler({ amount: 25.99, currency: 'USD' }, configuredCtx)
      expect(res.isError).toBe(false)
      expect(res.output).toContain('ORDER-123')
      expect(res.output).toContain('CREATED')
    })

    it('returns error when not configured', async () => {
      const res = await skill.handler({ amount: 10, currency: 'USD' }, { byoak: {} })
      expect(res.isError).toBe(true)
      expect(res.output).toContain('not configured')
    })
  })

  describe('paypal_capture_order', () => {
    const skill = getSkill('paypal_capture_order')!

    it('captures a PayPal order', async () => {
      mockAxiosPost
        .mockResolvedValueOnce({ data: { access_token: 'token' } })
        .mockResolvedValueOnce({ data: { id: 'ORDER-123', status: 'COMPLETED' } })
      const res = await skill.handler({ orderId: 'ORDER-123' }, configuredCtx)
      expect(res.isError).toBe(false)
      expect(res.output).toContain('COMPLETED')
    })
  })

  describe('paypal_list_orders', () => {
    const skill = getSkill('paypal_list_orders')!

    it('lists recent PayPal transactions', async () => {
      mockAxiosPost.mockResolvedValueOnce({ data: { access_token: 'token' } })
      mockAxiosGet.mockResolvedValueOnce({
        data: {
          transaction_details: [
            {
              transaction_info: {
                transaction_initiation_date: '2025-01-01T00:00:00Z',
                transaction_amount: { currency_code: 'USD', value: '25.00' },
                transaction_status: 'S',
                transaction_id: 'TXN-1',
              },
            },
          ],
        },
      })
      const res = await skill.handler({}, configuredCtx)
      expect(res.isError).toBe(false)
      expect(res.output).toContain('TXN-1')
      expect(res.output).toContain('25.00')
    })

    it('handles no transactions', async () => {
      mockAxiosPost.mockResolvedValueOnce({ data: { access_token: 'token' } })
      mockAxiosGet.mockResolvedValueOnce({ data: { transaction_details: [] } })
      const res = await skill.handler({}, configuredCtx)
      expect(res.output).toContain('No transactions found')
    })
  })
})
