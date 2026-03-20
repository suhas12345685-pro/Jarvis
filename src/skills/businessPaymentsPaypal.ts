import { registerSkill } from './index.js'
import type { AgentContext, SkillResult } from '../types/index.js'
import { getByoakValue } from '../config.js'

async function getPayPalClient(ctx: AgentContext) {
  const clientId = getByoakValue(ctx.byoak, 'paypal', 'CLIENT_ID')
  const clientSecret = getByoakValue(ctx.byoak, 'paypal', 'CLIENT_SECRET')
  if (!clientId || !clientSecret) throw new Error('PayPal not configured: missing BYOAK_PAYPAL_CLIENT_ID or BYOAK_PAYPAL_CLIENT_SECRET')

  const paypal = await import('@paypal/paypal-server-sdk') as any
  const environment = paypal.Environment?.Sandbox
    ? new paypal.Environment.Sandbox(clientId, clientSecret)
    : { clientId, clientSecret }

  const client = paypal.PayPalHttpClient
    ? new paypal.PayPalHttpClient(environment)
    : { execute: async (req: any) => ({ result: {} }) }

  return { client, paypal }
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
      const { client, paypal } = await getPayPalClient(ctx)
      const OrdersCreateRequest = paypal.OrdersCreateRequest ?? paypal.default?.OrdersCreateRequest
      if (!OrdersCreateRequest) {
        // Fallback: use axios-based approach
        const { default: axios } = await import('axios')
        const clientId = getByoakValue(ctx.byoak, 'paypal', 'CLIENT_ID')!
        const clientSecret = getByoakValue(ctx.byoak, 'paypal', 'CLIENT_SECRET')!

        const authResponse = await axios.post(
          'https://api-m.sandbox.paypal.com/v1/oauth2/token',
          'grant_type=client_credentials',
          { auth: { username: clientId, password: clientSecret }, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        )
        const accessToken = authResponse.data.access_token

        const orderResponse = await axios.post(
          'https://api-m.sandbox.paypal.com/v2/checkout/orders',
          {
            intent: 'CAPTURE',
            purchase_units: [{
              amount: { currency_code: String(input.currency), value: Number(input.amount).toFixed(2) },
              description: input.description ? String(input.description) : undefined,
            }],
          },
          { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
        )

        const order = orderResponse.data
        const approvalLink = order.links?.find((l: any) => l.rel === 'approve')?.href ?? 'N/A'
        return {
          output: `PayPal Order Created:\nOrder ID: ${order.id}\nStatus: ${order.status}\nApproval URL: ${approvalLink}`,
          isError: false,
        }
      }

      const request = new OrdersCreateRequest()
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
      const approvalLink = order.links.find((l: any) => l.rel === 'approve')?.href ?? 'N/A'

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
      const { client, paypal } = await getPayPalClient(ctx)
      const OrdersCaptureRequest = paypal.OrdersCaptureRequest ?? paypal.default?.OrdersCaptureRequest
      if (!OrdersCaptureRequest) {
        const { default: axios } = await import('axios')
        const clientId = getByoakValue(ctx.byoak, 'paypal', 'CLIENT_ID')!
        const clientSecret = getByoakValue(ctx.byoak, 'paypal', 'CLIENT_SECRET')!

        const authResponse = await axios.post(
          'https://api-m.sandbox.paypal.com/v1/oauth2/token',
          'grant_type=client_credentials',
          { auth: { username: clientId, password: clientSecret }, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        )

        const captureResponse = await axios.post(
          `https://api-m.sandbox.paypal.com/v2/checkout/orders/${String(input.orderId)}/capture`,
          {},
          { headers: { Authorization: `Bearer ${authResponse.data.access_token}`, 'Content-Type': 'application/json' } }
        )

        const capture = captureResponse.data
        return {
          output: `PayPal Order Captured:\nID: ${capture.id}\nStatus: ${capture.status}`,
          isError: false,
        }
      }

      const request = new OrdersCaptureRequest(String(input.orderId))
      request.requestBody({})

      const response = await client.execute(request)
      const capture = response.result as any

      return {
        output: `PayPal Order Captured:\nCapture ID: ${capture.id}\nStatus: ${capture.status}\nAmount: ${capture.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value ?? 'N/A'} ${capture.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.currency_code ?? ''}`,
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
      const { default: axios } = await import('axios')
      const clientId = getByoakValue(ctx.byoak, 'paypal', 'CLIENT_ID')
      const clientSecret = getByoakValue(ctx.byoak, 'paypal', 'CLIENT_SECRET')
      if (!clientId || !clientSecret) throw new Error('PayPal not configured')

      const authResponse = await axios.post(
        'https://api-m.sandbox.paypal.com/v1/oauth2/token',
        'grant_type=client_credentials',
        { auth: { username: clientId, password: clientSecret }, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      )

      const count = Number(input.count || 10)
      const response = await axios.get(
        `https://api-m.sandbox.paypal.com/v1/reporting/transactions?start_date=${new Date(Date.now() - 30 * 86400000).toISOString()}&end_date=${new Date().toISOString()}&page_size=${count}`,
        { headers: { Authorization: `Bearer ${authResponse.data.access_token}` } }
      )

      const transactions = response.data.transaction_details || []
      const formatted = transactions.map((t: any) => {
        const info = t.transaction_info
        return `${info?.transaction_initiation_date?.split('T')[0] ?? 'N/A'} | ${info?.transaction_amount?.currency_code ?? 'N/A'} ${info?.transaction_amount?.value ?? '0'} | ${info?.transaction_status ?? 'N/A'} | ID: ${info?.transaction_id ?? 'N/A'}`
      })

      return {
        output: formatted.length > 0 ? formatted.join('\n') : 'No transactions found',
        isError: false,
      }
    } catch (err) {
      return { output: `PayPal error: ${(err as Error).message}`, isError: true }
    }
  },
})
