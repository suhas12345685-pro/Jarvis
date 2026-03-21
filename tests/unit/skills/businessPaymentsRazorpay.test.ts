import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Razorpay
const mockOrdersCreate = vi.fn().mockResolvedValue({ id: 'order_123', amount: 50000, status: 'created', receipt: 'rcpt_1' })
const mockOrdersAll = vi.fn().mockResolvedValue({
  items: [
    { id: 'order_1', amount: 50000, currency: 'inr', status: 'paid', created_at: 1704067200 },
  ],
})
const mockPaymentsFetch = vi.fn().mockResolvedValue({
  id: 'pay_123', amount: 50000, status: 'captured', method: 'upi', card: null, bank: 'HDFC', wallet: null,
})
const mockPaymentsRefund = vi.fn().mockResolvedValue({
  id: 'rfnd_123', payment_id: 'pay_123', amount: 50000, status: 'processed', speed_requested: 'optimum',
})

vi.mock('razorpay', () => ({
  default: vi.fn().mockImplementation(() => ({
    orders: { create: mockOrdersCreate, all: mockOrdersAll },
    payments: { fetch: mockPaymentsFetch, refund: mockPaymentsRefund },
  })),
}))

// Mock config
vi.mock('../../../src/config.js', () => ({
  getByoakValue: vi.fn((byoak: any, provider: string, key: string) => {
    return byoak?.[`${provider}_${key}`] || null
  }),
}))

import { getSkill } from '../../../src/skills/index.js'
import '../../../src/skills/businessPaymentsRazorpay.js'

const configuredCtx: any = { byoak: { razorpay_KEY_ID: 'rzp_test', razorpay_KEY_SECRET: 'secret' } }

describe('businessPaymentsRazorpay skills', () => {
  beforeEach(() => vi.clearAllMocks())

  describe('razorpay_create_order', () => {
    const skill = getSkill('razorpay_create_order')!

    it('creates a Razorpay order', async () => {
      const res = await skill.handler({ amount: 50000 }, configuredCtx)
      expect(res.isError).toBe(false)
      expect(res.output).toContain('order_123')
      expect(res.output).toContain('500.00')
    })

    it('returns error when not configured', async () => {
      const res = await skill.handler({ amount: 1000 }, { byoak: {} })
      expect(res.isError).toBe(true)
      expect(res.output).toContain('not configured')
    })
  })

  describe('razorpay_list_orders', () => {
    const skill = getSkill('razorpay_list_orders')!

    it('lists recent orders', async () => {
      const res = await skill.handler({}, configuredCtx)
      expect(res.isError).toBe(false)
      expect(res.output).toContain('order_1')
      expect(res.output).toContain('500.00')
    })

    it('handles no orders', async () => {
      mockOrdersAll.mockResolvedValueOnce({ items: [] })
      const res = await skill.handler({}, configuredCtx)
      expect(res.output).toContain('No orders found')
    })
  })

  describe('razorpay_get_payment', () => {
    const skill = getSkill('razorpay_get_payment')!

    it('fetches payment details', async () => {
      const res = await skill.handler({ paymentId: 'pay_123' }, configuredCtx)
      expect(res.isError).toBe(false)
      expect(res.output).toContain('pay_123')
      expect(res.output).toContain('captured')
      expect(res.output).toContain('upi')
    })
  })

  describe('razorpay_refund', () => {
    const skill = getSkill('razorpay_refund')!

    it('initiates a refund', async () => {
      const res = await skill.handler({ paymentId: 'pay_123' }, configuredCtx)
      expect(res.isError).toBe(false)
      expect(res.output).toContain('rfnd_123')
      expect(res.output).toContain('processed')
    })
  })
})
