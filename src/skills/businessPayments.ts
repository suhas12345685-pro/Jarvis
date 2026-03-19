import { registerSkill } from './index.js'
import type { AgentContext, SkillResult } from '../types/index.js'
import { getByoakValue } from '../config.js'

function getStripe(ctx: AgentContext) {
  const secretKey = getByoakValue(ctx.byoak, 'stripe', 'SECRET_KEY')
  if (!secretKey) throw new Error('Stripe not configured: missing BYOAK_STRIPE_SECRET_KEY')
  return import('stripe').then(({ default: Stripe }) => new Stripe(secretKey))
}

registerSkill({
  name: 'stripe_list_charges',
  description: 'List recent Stripe charges/payments.',
  inputSchema: {
    type: 'object',
    properties: {
      limit: { type: 'number', description: 'Number of charges to retrieve (default: 10, max: 100)' },
      customerId: { type: 'string', description: 'Filter by customer ID (optional)' },
    },
    required: [],
  },
  handler: async (input: Record<string, unknown>, ctx: AgentContext): Promise<SkillResult> => {
    try {
      const stripe = await getStripe(ctx)
      const charges = await stripe.charges.list({
        limit: Math.min(Number(input.limit ?? 10), 100),
        customer: input.customerId ? String(input.customerId) : undefined,
      })

      const formatted = charges.data.map(c => {
        const amount = (c.amount / 100).toFixed(2)
        const currency = c.currency.toUpperCase()
        const status = c.status
        const date = new Date(c.created * 1000).toISOString().split('T')[0]
        return `${date} | ${currency} ${amount} | ${status} | ${c.description ?? 'No description'} | ID: ${c.id}`
      })

      return {
        output: formatted.length > 0 ? formatted.join('\n') : 'No charges found',
        isError: false,
      }
    } catch (err) {
      return { output: `Stripe error: ${(err as Error).message}`, isError: true }
    }
  },
})

registerSkill({
  name: 'stripe_create_payment_intent',
  description: 'Create a Stripe PaymentIntent for a specified amount and currency.',
  inputSchema: {
    type: 'object',
    properties: {
      amount: { type: 'number', description: 'Amount in smallest currency unit (e.g. cents for USD)' },
      currency: { type: 'string', description: 'Three-letter ISO currency code (e.g. "usd")' },
      description: { type: 'string', description: 'Payment description (optional)' },
      customerId: { type: 'string', description: 'Existing Stripe customer ID (optional)' },
    },
    required: ['amount', 'currency'],
  },
  handler: async (input: Record<string, unknown>, ctx: AgentContext): Promise<SkillResult> => {
    try {
      const stripe = await getStripe(ctx)
      const intent = await stripe.paymentIntents.create({
        amount: Number(input.amount),
        currency: String(input.currency),
        description: input.description ? String(input.description) : undefined,
        customer: input.customerId ? String(input.customerId) : undefined,
        automatic_payment_methods: { enabled: true },
      })

      return {
        output: `PaymentIntent created:\nID: ${intent.id}\nClient Secret: ${intent.client_secret}\nStatus: ${intent.status}\nAmount: ${(intent.amount / 100).toFixed(2)} ${intent.currency.toUpperCase()}`,
        isError: false,
      }
    } catch (err) {
      return { output: `Stripe error: ${(err as Error).message}`, isError: true }
    }
  },
})

registerSkill({
  name: 'stripe_create_customer',
  description: 'Create a new Stripe customer.',
  inputSchema: {
    type: 'object',
    properties: {
      email: { type: 'string', description: 'Customer email address' },
      name: { type: 'string', description: 'Customer full name (optional)' },
      description: { type: 'string', description: 'Internal description (optional)' },
    },
    required: ['email'],
  },
  handler: async (input: Record<string, unknown>, ctx: AgentContext): Promise<SkillResult> => {
    try {
      const stripe = await getStripe(ctx)
      const customer = await stripe.customers.create({
        email: String(input.email),
        name: input.name ? String(input.name) : undefined,
        description: input.description ? String(input.description) : undefined,
      })
      return {
        output: `Customer created: ${customer.id} (${customer.email})`,
        isError: false,
      }
    } catch (err) {
      return { output: `Stripe error: ${(err as Error).message}`, isError: true }
    }
  },
})

registerSkill({
  name: 'stripe_create_invoice',
  description: 'Create and send a Stripe invoice to a customer.',
  inputSchema: {
    type: 'object',
    properties: {
      customerId: { type: 'string', description: 'Stripe customer ID' },
      description: { type: 'string', description: 'Invoice item description' },
      amount: { type: 'number', description: 'Amount in smallest currency unit (e.g. cents)' },
      currency: { type: 'string', description: 'Currency code (e.g. "usd")' },
      autoAdvance: { type: 'boolean', description: 'Auto-finalize and send the invoice (default: true)' },
    },
    required: ['customerId', 'description', 'amount', 'currency'],
  },
  handler: async (input: Record<string, unknown>, ctx: AgentContext): Promise<SkillResult> => {
    try {
      const stripe = await getStripe(ctx)

      await stripe.invoiceItems.create({
        customer: String(input.customerId),
        amount: Number(input.amount),
        currency: String(input.currency),
        description: String(input.description),
      })

      const invoice = await stripe.invoices.create({
        customer: String(input.customerId),
        auto_advance: input.autoAdvance !== false,
      })

      const finalized = await stripe.invoices.finalizeInvoice(invoice.id)

      return {
        output: `Invoice created and sent:\nID: ${finalized.id}\nStatus: ${finalized.status}\nTotal: ${((finalized.amount_due ?? 0) / 100).toFixed(2)} ${(finalized.currency ?? '').toUpperCase()}\nHosted URL: ${finalized.hosted_invoice_url}`,
        isError: false,
      }
    } catch (err) {
      return { output: `Stripe invoice error: ${(err as Error).message}`, isError: true }
    }
  },
})
