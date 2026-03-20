import { registerSkill } from './index.js'
import type { AgentContext, SkillResult } from '../types/index.js'
import { getByoakValue } from '../config.js'

function getRazorpay(ctx: AgentContext) {
  const keyId = getByoakValue(ctx.byoak, 'razorpay', 'KEY_ID')
  const keySecret = getByoakValue(ctx.byoak, 'razorpay', 'KEY_SECRET')
  if (!keyId || !keySecret) throw new Error('Razorpay not configured: missing BYOAK_RAZORPAY_KEY_ID or BYOAK_RAZORPAY_KEY_SECRET')
  return import('razorpay').then(({ default: Razorpay }) => new Razorpay({ key_id: keyId, key_secret: keySecret }))
}

registerSkill({
  name: 'razorpay_create_order',
  description: 'Create a Razorpay order for accepting payments.',
  inputSchema: {
    type: 'object',
    properties: {
      amount: { type: 'number', description: 'Amount in paise (INR smallest unit)' },
      currency: { type: 'string', description: 'Currency code (default: INR)' },
      receipt: { type: 'string', description: 'Unique receipt ID (optional)' },
      notes: { type: 'string', description: 'JSON notes for the order (optional)' },
    },
    required: ['amount'],
  },
  handler: async (input: Record<string, unknown>, ctx: AgentContext): Promise<SkillResult> => {
    try {
      const razorpay = await getRazorpay(ctx)
      const order = await razorpay.orders.create({
        amount: Number(input.amount),
        currency: String(input.currency ?? 'INR'),
        receipt: input.receipt ? String(input.receipt) : undefined,
        notes: input.notes ? JSON.parse(String(input.notes)) : undefined,
      })
      return {
        output: `Razorpay Order Created:\nOrder ID: ${order.id}\nAmount: ₹${(Number(order.amount) / 100).toFixed(2)}\nStatus: ${order.status}\nReceipt: ${order.receipt}`,
        isError: false,
      }
    } catch (err) {
      return { output: `Razorpay error: ${(err as Error).message}`, isError: true }
    }
  },
})

registerSkill({
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
        `${o.created_at ? new Date(o.created_at * 1000).toISOString().split('T')[0] : 'N/A'} | ${o.currency?.toUpperCase() ?? 'INR'} ${(Number(o.amount ?? 0) / 100).toFixed(2)} | ${o.status} | ID: ${o.id}`
      )
      return {
        output: formatted.length > 0 ? formatted.join('\n') : 'No orders found',
        isError: false,
      }
    } catch (err) {
      return { output: `Razorpay error: ${(err as Error).message}`, isError: true }
    }
  },
})

registerSkill({
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
        output: `Payment Details:\nID: ${payment.id}\nAmount: ₹${(Number(payment.amount) / 100).toFixed(2)}\nStatus: ${payment.status}\nMethod: ${payment.method}\nCard Type: ${payment.card?.type ?? 'N/A'}\nBank: ${payment.bank ?? 'N/A'}\nWallet: ${payment.wallet ?? 'N/A'}`,
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
        output: `Refund Initiated:\nRefund ID: ${refund.id}\nPayment ID: ${refund.payment_id}\nAmount: ₹${(Number(refund.amount ?? 0) / 100).toFixed(2)}\nStatus: ${refund.status}\nSpeed: ${refund.speed_requested}`,
        isError: false,
      }
    } catch (err) {
      return { output: `Razorpay refund error: ${(err as Error).message}`, isError: true }
    }
  },
})
