import { registerSkill } from './index.js'
import type { AgentContext, SkillResult } from '../types/index.js'
import { getByoakValue } from '../config.js'

async function getPayPalClient(ctx: AgentContext) {
  const clientId = getByoakValue(ctx.byoak, 'paypal', 'CLIENT_ID')
  const clientSecret = getByoakValue(ctx.byoak, 'paypal', 'CLIENT_SECRET')
  if (!clientId || !clientSecret) throw new Error('PayPal not configured: missing BYOAK_PAYPAL_CLIENT_ID or BYOAK_PAYPAL_CLIENT_SECRET')

  const { PayPalHttpClient, Environment, enums } = await import('@paypal/paypal-server-sdk')
  const client = new PayPalHttpClient(new Environment.Sandbox(clientId, clientSecret))
  return { client, enums }
}

registerSkill({
  name: 'paypal_create_order',
  description: 'Create a PayPal order for checkout.',
  inputSchema: {
    type: 'object',
    properties: {
      amount: { type: 'number', description: 'Order amount' },
      currency: { type: 'string', description: 'Currency code (e.g., USD, EUR)' },
      description: { type: 'string', description: 'Order description' },
    },
    required: ['amount', 'currency'],
  },
  handler: async (input: Record<string, unknown>, ctx: AgentContext): Promise<SkillResult> => {
    try {
      const { client, enums } = await getPayPalClient(ctx)
      const request = new (await import('@paypal/paypal-server-sdk')).OrdersCreateRequest()
      request.requestBody({
        intent: 'CAPTURE',
        purchase_units: [{
          amount: {
            currency_code: String(input.currency),
            value: Number(input.amount).toFixed(2),
          },
          description: input.description ? String(input.description) : undefined,
        }],
      })

      const response = await client.execute(request)
      const order = response.result as { id: string; status: string; links: Array<{ href: string; rel: string }> }
      const approvalLink = order.links.find(l => l.rel === 'approve')?.href ?? 'N/A'

      return {
        output: `PayPal Order Created:\nOrder ID: ${order.id}\nStatus: ${order.status}\nApproval URL: ${approvalLink}`,
        isError: false,
      }
    } catch (err) {
      return { output: `PayPal error: ${(err as Error).message}`, isError: true }
    }
  },
})

registerSkill({
  name: 'paypal_capture_order',
  description: 'Capture/verify a PayPal order after buyer approval.',
  inputSchema: {
    type: 'object',
    properties: {
      orderId: { type: 'string', description: 'PayPal order ID to capture' },
    },
    required: ['orderId'],
  },
  handler: async (input: Record<string, unknown>, ctx: AgentContext): Promise<SkillResult> => {
    try {
      const { client } = await getPayPalClient(ctx)
      const request = new (await import('@paypal/paypal-server-sdk')).OrdersCaptureRequest(String(input.orderId))
      request.requestBody({})

      const response = await client.execute(request)
      const capture = response.result as { id: string; status: string; purchase_units: Array<{ payments: { captures: Array<{ amount: { value: string; currency_code: string } }> } }> }

      return {
        output: `PayPal Order Captured:\nCapture ID: ${capture.id}\nStatus: ${capture.status}\nAmount: ${capture.purchase_units[0]?.payments?.captures[0]?.amount?.value ?? 'N/A'} ${capture.purchase_units[0]?.payments?.captures[0]?.amount?.currency_code ?? ''}`,
        isError: false,
      }
    } catch (err) {
      return { output: `PayPal capture error: ${(err as Error).message}`, isError: true }
    }
  },
})

registerSkill({
  name: 'paypal_list_orders',
  description: 'List recent PayPal orders.',
  inputSchema: {
    type: 'object',
    properties: {
      count: { type: 'number', description: 'Number of orders to retrieve (default: 10)' },
    },
  },
  handler: async (input: Record<string, unknown>, ctx: AgentContext): Promise<SkillResult> => {
    try {
      const { client } = await getPayPalClient(ctx)
      const request = new (await import('@paypal/paypal-server-sdk')).OrdersListRequest(String(input.count ?? 10))
      const response = await client.execute(request)
      const orders = (response.result as { orders: Array<{ id: string; status: string; create_time: string; amount: { value: string; currency_code: string } }> }).orders

      const formatted = orders.map(o =>
        `${o.create_time?.split('T')[0] ?? 'N/A'} | ${o.amount?.currency_code ?? 'N/A'} ${o.amount?.value ?? '0'} | ${o.status} | ID: ${o.id}`
      )

      return {
        output: formatted.length > 0 ? formatted.join('\n') : 'No orders found',
        isError: false,
      }
    } catch (err) {
      return { output: `PayPal error: ${(err as Error).message}`, isError: true }
    }
  },
})
