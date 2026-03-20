import { registerSkill } from './index.js'
import type { AgentContext, SkillResult } from '../types/index.js'
import { getByoakValue } from '../config.js'

<<<<<<< HEAD
function getRazorpay(ctx: AgentContext) {
  const keyId = getByoakValue(ctx.byoak, 'razorpay', 'KEY_ID')
  const keySecret = getByoakValue(ctx.byoak, 'razorpay', 'KEY_SECRET')
  if (!keyId || !keySecret) throw new Error('Razorpay not configured: missing BYOAK_RAZORPAY_KEY_ID or BYOAK_RAZORPAY_KEY_SECRET')
  return import('razorpay').then(({ default: Razorpay }) => new Razorpay({ key_id: keyId, key_secret: keySecret }))
=======
function getRazorpayClient(ctx: AgentContext) {
  const keyId = getByoakValue(ctx.byoak, 'razorpay', 'KEY_ID')
  const keySecret = getByoakValue(ctx.byoak, 'razorpay', 'KEY_SECRET')

  if (!keyId || !keySecret) {
    throw new Error('Razorpay not configured: missing BYOAK_RAZORPAY_KEY_ID or BYOAK_RAZORPAY_KEY_SECRET')
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Razorpay = require('razorpay') as new (opts: { key_id: string; key_secret: string }) => RazorpayInstance
  return new Razorpay({ key_id: keyId, key_secret: keySecret })
}

interface RazorpayInstance {
  orders: {
    create(params: Record<string, unknown>): Promise<Record<string, unknown>>
  }
  payments: {
    all(params?: Record<string, unknown>): Promise<{ items: Record<string, unknown>[] }>
    refund(paymentId: string, params: Record<string, unknown>): Promise<Record<string, unknown>>
  }
  invoices: {
    create(params: Record<string, unknown>): Promise<Record<string, unknown>>
  }
>>>>>>> e0d59e7b5270ae6d2f51bb3f447c22895f8fee54
}

registerSkill({
  name: 'razorpay_create_order',
<<<<<<< HEAD
  description: 'Create a Razorpay order for accepting payments.',
  inputSchema: {
    type: 'object',
    properties: {
      amount: { type: 'number', description: 'Amount in paise (INR smallest unit)' },
      currency: { type: 'string', description: 'Currency code (default: INR)' },
      receipt: { type: 'string', description: 'Unique receipt ID (optional)' },
      notes: { type: 'string', description: 'JSON notes for the order (optional)' },
=======
  description: 'Create a Razorpay payment order.',
  inputSchema: {
    type: 'object',
    properties: {
      amount: { type: 'number', description: 'Amount in smallest currency unit (e.g. paise for INR)' },
      currency: { type: 'string', description: 'ISO currency code (default: INR)' },
      receipt: { type: 'string', description: 'Receipt ID for your records' },
      notes: { type: 'object', description: 'Key-value notes to attach to order' },
>>>>>>> e0d59e7b5270ae6d2f51bb3f447c22895f8fee54
    },
    required: ['amount'],
  },
  handler: async (input: Record<string, unknown>, ctx: AgentContext): Promise<SkillResult> => {
    try {
<<<<<<< HEAD
      const razorpay = await getRazorpay(ctx)
      const order = await razorpay.orders.create({
        amount: Number(input.amount),
        currency: String(input.currency ?? 'INR'),
        receipt: input.receipt ? String(input.receipt) : undefined,
        notes: input.notes ? JSON.parse(String(input.notes)) : undefined,
      })
      return {
        output: `Razorpay Order Created:\nOrder ID: ${order.id}\nAmount: ₹${(order.amount / 100).toFixed(2)}\nStatus: ${order.status}\nReceipt: ${order.receipt}`,
        isError: false,
      }
    } catch (err) {
      return { output: `Razorpay error: ${(err as Error).message}`, isError: true }
=======
      const rz = getRazorpayClient(ctx)
      const order = await rz.orders.create({
        amount: Number(input.amount),
        currency: String(input.currency ?? 'INR'),
        receipt: input.receipt ? String(input.receipt) : undefined,
        notes: input.notes ?? {},
      })

      return {
        output: `Order created: ${order.id}\nAmount: ${order.amount} ${order.currency}\nStatus: ${order.status}`,
        isError: false,
      }
    } catch (err) {
      return { output: `Razorpay order error: ${(err as Error).message}`, isError: true }
>>>>>>> e0d59e7b5270ae6d2f51bb3f447c22895f8fee54
    }
  },
})

registerSkill({
<<<<<<< HEAD
  name: 'razorpay_list_orders',
  description: 'List recent Razorpay orders.',
  inputSchema: {
    type: 'object',
    properties: {
      count: { type: 'number', description: 'Number of orders to retrieve (default: 10)' },
    },
  },
  handler: async (input: Record<string, unknown>, ctx: AgentContext): Promise<SkillResult> => {
    try {
      const razorpay = await getRazorpay(ctx)
      const orders = await razorpay.orders.all({ count: Math.min(Number(input.count ?? 10), 100) })
      const formatted = orders.items.map(o =>
        `${o.created_at ? new Date(o.created_at * 1000).toISOString().split('T')[0] : 'N/A'} | ${o.currency?.toUpperCase() ?? 'INR'} ${((o.amount ?? 0) / 100).toFixed(2)} | ${o.status} | ID: ${o.id}`
      )
      return {
        output: formatted.length > 0 ? formatted.join('\n') : 'No orders found',
        isError: false,
      }
    } catch (err) {
      return { output: `Razorpay error: ${(err as Error).message}`, isError: true }
=======
  name: 'razorpay_fetch_payments',
  description: 'List recent Razorpay payments.',
  inputSchema: {
    type: 'object',
    properties: {
      count: { type: 'number', description: 'Number of payments to fetch (default: 10, max: 100)' },
      skip: { type: 'number', description: 'Number of payments to skip (for pagination)' },
    },
    required: [],
  },
  handler: async (input: Record<string, unknown>, ctx: AgentContext): Promise<SkillResult> => {
    try {
      const rz = getRazorpayClient(ctx)
      const result = await rz.payments.all({
        count: Math.min(Number(input.count ?? 10), 100),
        skip: Number(input.skip ?? 0),
      })

      const payments = result.items ?? []
      if (payments.length === 0) return { output: 'No payments found', isError: false }

      const formatted = payments.map(p =>
        `• ${p.id} — ${p.amount} ${p.currency} — ${p.status} — ${p.method ?? 'N/A'}`
      )
      return { output: formatted.join('\n'), isError: false }
    } catch (err) {
      return { output: `Razorpay list error: ${(err as Error).message}`, isError: true }
>>>>>>> e0d59e7b5270ae6d2f51bb3f447c22895f8fee54
    }
  },
})

registerSkill({
<<<<<<< HEAD
  name: 'razorpay_get_payment',
  description: 'Get details of a specific Razorpay payment by payment ID.',
  inputSchema: {
    type: 'object',
    properties: {
      paymentId: { type: 'string', description: 'Razorpay payment ID' },
    },
    required: ['paymentId'],
  },
  handler: async (input: Record<string, unknown>, ctx: AgentContext): Promise<SkillResult> => {
    try {
      const razorpay = await getRazorpay(ctx)
      const payment = await razorpay.payments.fetch(String(input.paymentId))
      return {
        output: `Payment Details:\nID: ${payment.id}\nAmount: ₹${(payment.amount / 100).toFixed(2)}\nStatus: ${payment.status}\nMethod: ${payment.method}\nCard Type: ${payment.card?.type ?? 'N/A'}\nBank: ${payment.bank ?? 'N/A'}\nWallet: ${payment.wallet ?? 'N/A'}`,
        isError: false,
      }
    } catch (err) {
      return { output: `Razorpay error: ${(err as Error).message}`, isError: true }
    }
  },
})

registerSkill({
  name: 'razorpay_refund',
  description: 'Initiate a refund for a Razorpay payment.',
  inputSchema: {
    type: 'object',
    properties: {
      paymentId: { type: 'string', description: 'Payment ID to refund' },
      amount: { type: 'number', description: 'Amount to refund in paise (optional, full refund if omitted)' },
      speed: { type: 'string', description: 'Refund speed: "optimum" or "normal"' },
      notes: { type: 'string', description: 'Refund notes (optional)' },
    },
    required: ['paymentId'],
  },
  handler: async (input: Record<string, unknown>, ctx: AgentContext): Promise<SkillResult> => {
    try {
      const razorpay = await getRazorpay(ctx)
      const refund = await razorpay.payments.refund(String(input.paymentId), {
        amount: input.amount ? Number(input.amount) : undefined,
        speed: input.speed ? String(input.speed) as 'optimum' | 'normal' : undefined,
        notes: input.notes ? JSON.parse(String(input.notes)) : undefined,
      })
      return {
        output: `Refund Initiated:\nRefund ID: ${refund.id}\nPayment ID: ${refund.payment_id}\nAmount: ₹${(refund.amount / 100).toFixed(2)}\nStatus: ${refund.status}\nSpeed: ${refund.speed_requested}`,
=======
  name: 'razorpay_create_invoice',
  description: 'Create and send a Razorpay invoice.',
  inputSchema: {
    type: 'object',
    properties: {
      customerName: { type: 'string', description: 'Customer name' },
      customerEmail: { type: 'string', description: 'Customer email' },
      amount: { type: 'number', description: 'Amount in smallest currency unit' },
      currency: { type: 'string', description: 'ISO currency code (default: INR)' },
      description: { type: 'string', description: 'Invoice description' },
    },
    required: ['customerName', 'customerEmail', 'amount'],
  },
  handler: async (input: Record<string, unknown>, ctx: AgentContext): Promise<SkillResult> => {
    try {
      const rz = getRazorpayClient(ctx)
      const invoice = await rz.invoices.create({
        type: 'invoice',
        customer: {
          name: String(input.customerName),
          email: String(input.customerEmail),
        },
        line_items: [
          {
            name: String(input.description ?? 'Service'),
            amount: Number(input.amount),
            currency: String(input.currency ?? 'INR'),
            quantity: 1,
          },
        ],
      })

      return {
        output: `Invoice created: ${invoice.id}\nShort URL: ${invoice.short_url}\nStatus: ${invoice.status}`,
        isError: false,
      }
    } catch (err) {
      return { output: `Razorpay invoice error: ${(err as Error).message}`, isError: true }
    }
  },
})

registerSkill({
  name: 'razorpay_issue_refund',
  description: 'Issue a refund for a Razorpay payment.',
  inputSchema: {
    type: 'object',
    properties: {
      paymentId: { type: 'string', description: 'Payment ID to refund (e.g. pay_ABC123)' },
      amount: { type: 'number', description: 'Refund amount in smallest unit (omit for full refund)' },
      notes: { type: 'object', description: 'Notes for the refund' },
    },
    required: ['paymentId'],
  },
  handler: async (input: Record<string, unknown>, ctx: AgentContext): Promise<SkillResult> => {
    try {
      const rz = getRazorpayClient(ctx)
      const params: Record<string, unknown> = {}
      if (input.amount) params.amount = Number(input.amount)
      if (input.notes) params.notes = input.notes

      const refund = await rz.payments.refund(String(input.paymentId), params)
      return {
        output: `Refund created: ${refund.id}\nAmount: ${refund.amount}\nStatus: ${refund.status}`,
>>>>>>> e0d59e7b5270ae6d2f51bb3f447c22895f8fee54
        isError: false,
      }
    } catch (err) {
      return { output: `Razorpay refund error: ${(err as Error).message}`, isError: true }
    }
  },
})
