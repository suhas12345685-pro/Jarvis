import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Stripe
const mockChargesList = vi.fn().mockResolvedValue({
  data: [
    { amount: 2500, currency: 'usd', status: 'succeeded', created: 1704067200, description: 'Test charge', id: 'ch_123' },
  ],
})
const mockPaymentIntentsCreate = vi.fn().mockResolvedValue({
  id: 'pi_123', client_secret: 'pi_123_secret', status: 'requires_payment_method', amount: 5000, currency: 'usd',
})
const mockCustomersCreate = vi.fn().mockResolvedValue({ id: 'cus_123', email: 'test@test.com' })
const mockInvoiceItemsCreate = vi.fn().mockResolvedValue({})
const mockInvoicesCreate = vi.fn().mockResolvedValue({ id: 'inv_123' })
const mockInvoicesFinalize = vi.fn().mockResolvedValue({
  id: 'inv_123', status: 'open', amount_due: 5000, currency: 'usd', hosted_invoice_url: 'https://invoice.stripe.com/inv_123',
})

vi.mock('stripe', () => ({
  default: vi.fn().mockImplementation(() => ({
    charges: { list: mockChargesList },
    paymentIntents: { create: mockPaymentIntentsCreate },
    customers: { create: mockCustomersCreate },
    invoiceItems: { create: mockInvoiceItemsCreate },
    invoices: { create: mockInvoicesCreate, finalizeInvoice: mockInvoicesFinalize },
  })),
}))

// Mock config
vi.mock('../../../src/config.js', () => ({
  getByoakValue: vi.fn((byoak: any, provider: string, key: string) => {
    return byoak?.[`${provider}_${key}`] || null
  }),
}))

import { getSkill } from '../../../src/skills/index.js'
import '../../../src/skills/businessPayments.js'

const configuredCtx: any = { byoak: { stripe_SECRET_KEY: 'sk_test_123' } }

describe('businessPayments skills', () => {
  beforeEach(() => vi.clearAllMocks())

  describe('stripe_list_charges', () => {
    const skill = getSkill('stripe_list_charges')!

    it('lists recent charges', async () => {
      const res = await skill.handler({}, configuredCtx)
      expect(res.isError).toBe(false)
      expect(res.output).toContain('25.00')
      expect(res.output).toContain('USD')
      expect(res.output).toContain('succeeded')
    })

    it('handles no charges', async () => {
      mockChargesList.mockResolvedValueOnce({ data: [] })
      const res = await skill.handler({}, configuredCtx)
      expect(res.output).toContain('No charges found')
    })

    it('returns error when not configured', async () => {
      const res = await skill.handler({}, { byoak: {} })
      expect(res.isError).toBe(true)
      expect(res.output).toContain('not configured')
    })
  })

  describe('stripe_create_payment_intent', () => {
    const skill = getSkill('stripe_create_payment_intent')!

    it('creates a payment intent', async () => {
      const res = await skill.handler({ amount: 5000, currency: 'usd' }, configuredCtx)
      expect(res.isError).toBe(false)
      expect(res.output).toContain('pi_123')
      expect(res.output).toContain('50.00')
    })
  })

  describe('stripe_create_customer', () => {
    const skill = getSkill('stripe_create_customer')!

    it('creates a customer', async () => {
      const res = await skill.handler({ email: 'test@test.com', name: 'Test User' }, configuredCtx)
      expect(res.isError).toBe(false)
      expect(res.output).toContain('cus_123')
      expect(res.output).toContain('test@test.com')
    })
  })

  describe('stripe_create_invoice', () => {
    const skill = getSkill('stripe_create_invoice')!

    it('creates and sends an invoice', async () => {
      const res = await skill.handler({
        customerId: 'cus_123',
        description: 'Monthly service',
        amount: 5000,
        currency: 'usd',
      }, configuredCtx)
      expect(res.isError).toBe(false)
      expect(res.output).toContain('inv_123')
      expect(res.output).toContain('50.00')
      expect(mockInvoiceItemsCreate).toHaveBeenCalled()
      expect(mockInvoicesFinalize).toHaveBeenCalled()
    })
  })
})
