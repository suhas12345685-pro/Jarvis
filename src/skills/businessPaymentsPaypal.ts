import { registerSkill } from './index.js'
import type { AgentContext, SkillResult } from '../types/index.js'
import { getByoakValue } from '../config.js'

<<<<<<< HEAD
async function getPayPalClient(ctx: AgentContext) {
  const clientId = getByoakValue(ctx.byoak, 'paypal', 'CLIENT_ID')
  const clientSecret = getByoakValue(ctx.byoak, 'paypal', 'CLIENT_SECRET')
  if (!clientId || !clientSecret) throw new Error('PayPal not configured: missing BYOAK_PAYPAL_CLIENT_ID or BYOAK_PAYPAL_CLIENT_SECRET')

  const { PayPalHttpClient, Environment, enums } = await import('@paypal/paypal-server-sdk')
  const client = new PayPalHttpClient(new Environment.Sandbox(clientId, clientSecret))
  return { client, enums }
=======
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getPaypalClient(ctx: AgentContext): Promise<any> {
  const clientId = getByoakValue(ctx.byoak, 'paypal', 'CLIENT_ID')
  const clientSecret = getByoakValue(ctx.byoak, 'paypal', 'CLIENT_SECRET')
  const environment = getByoakValue(ctx.byoak, 'paypal', 'ENVIRONMENT') ?? 'sandbox'

  if (!clientId || !clientSecret) {
    throw new Error('PayPal not configured: missing BYOAK_PAYPAL_CLIENT_ID or BYOAK_PAYPAL_CLIENT_SECRET')
  }

  const paypal = await import('@paypal/paypal-server-sdk')
  const client = new paypal.Client({
    clientCredentialsAuthCredentials: {
      oAuthClientId: clientId,
      oAuthClientSecret: clientSecret,
    },
    environment: environment === 'live'
      ? paypal.Environment.Production
      : paypal.Environment.Sandbox,
  })

  return { client, paypal }
>>>>>>> e0d59e7b5270ae6d2f51bb3f447c22895f8fee54
}

registerSkill({
  name: 'paypal_create_order',
<<<<<<< HEAD
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
=======
  description: 'Create a PayPal payment order.',
  inputSchema: {
    type: 'object',
    properties: {
      amount: { type: 'string', description: 'Amount as string (e.g. "10.00")' },
      currency: { type: 'string', description: 'ISO currency code (default: USD)' },
      description: { type: 'string', description: 'Order description' },
    },
    required: ['amount'],
  },
  handler: async (input: Record<string, unknown>, ctx: AgentContext): Promise<SkillResult> => {
    try {
      const { client, paypal } = await getPaypalClient(ctx)
      const ordersController = new paypal.OrdersController(client)

      const response = await ordersController.ordersCreate({
        body: {
          intent: 'CAPTURE',
          purchaseUnits: [
            {
              amount: {
                currencyCode: String(input.currency ?? 'USD'),
                value: String(input.amount),
              },
              description: input.description ? String(input.description) : undefined,
            },
          ],
        },
      })

      const order = response.result
      return {
        output: `PayPal order created: ${order.id}\nStatus: ${order.status}\nApprove link: ${order.links?.find((l: { rel: string }) => l.rel === 'approve')?.href ?? 'N/A'}`,
        isError: false,
      }
    } catch (err) {
      return { output: `PayPal order error: ${(err as Error).message}`, isError: true }
>>>>>>> e0d59e7b5270ae6d2f51bb3f447c22895f8fee54
    }
  },
})

registerSkill({
  name: 'paypal_capture_order',
<<<<<<< HEAD
  description: 'Capture/verify a PayPal order after buyer approval.',
=======
  description: 'Capture an approved PayPal order to complete payment.',
>>>>>>> e0d59e7b5270ae6d2f51bb3f447c22895f8fee54
  inputSchema: {
    type: 'object',
    properties: {
      orderId: { type: 'string', description: 'PayPal order ID to capture' },
    },
    required: ['orderId'],
  },
  handler: async (input: Record<string, unknown>, ctx: AgentContext): Promise<SkillResult> => {
    try {
<<<<<<< HEAD
      const { client } = await getPayPalClient(ctx)
      const request = new (await import('@paypal/paypal-server-sdk')).OrdersCaptureRequest(String(input.orderId))
      request.requestBody({})

      const response = await client.execute(request)
      const capture = response.result as { id: string; status: string; purchase_units: Array<{ payments: { captures: Array<{ amount: { value: string; currency_code: string } }> } }> }

      return {
        output: `PayPal Order Captured:\nCapture ID: ${capture.id}\nStatus: ${capture.status}\nAmount: ${capture.purchase_units[0]?.payments?.captures[0]?.amount?.value ?? 'N/A'} ${capture.purchase_units[0]?.payments?.captures[0]?.amount?.currency_code ?? ''}`,
=======
      const { client, paypal } = await getPaypalClient(ctx)
      const ordersController = new paypal.OrdersController(client)

      const response = await ordersController.ordersCapture({
        id: String(input.orderId),
      })

      const result = response.result
      return {
        output: `Order captured: ${result.id}\nStatus: ${result.status}`,
>>>>>>> e0d59e7b5270ae6d2f51bb3f447c22895f8fee54
        isError: false,
      }
    } catch (err) {
      return { output: `PayPal capture error: ${(err as Error).message}`, isError: true }
    }
  },
})

registerSkill({
<<<<<<< HEAD
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
=======
  name: 'paypal_issue_refund',
  description: 'Refund a captured PayPal payment.',
  inputSchema: {
    type: 'object',
    properties: {
      captureId: { type: 'string', description: 'Capture ID to refund' },
      amount: { type: 'string', description: 'Refund amount as string (omit for full refund)' },
      currency: { type: 'string', description: 'ISO currency code (default: USD)' },
      note: { type: 'string', description: 'Reason for refund' },
    },
    required: ['captureId'],
  },
  handler: async (input: Record<string, unknown>, ctx: AgentContext): Promise<SkillResult> => {
    try {
      const { client, paypal } = await getPaypalClient(ctx)
      const paymentsController = new paypal.PaymentsController(client)

      const body: Record<string, unknown> = {}
      if (input.amount) {
        body.amount = {
          currencyCode: String(input.currency ?? 'USD'),
          value: String(input.amount),
        }
      }
      if (input.note) body.noteToPayer = String(input.note)

      const response = await paymentsController.capturesRefund({
        captureId: String(input.captureId),
        body,
      })

      const result = response.result
      return {
        output: `Refund issued: ${result.id}\nStatus: ${result.status}`,
        isError: false,
      }
    } catch (err) {
      return { output: `PayPal refund error: ${(err as Error).message}`, isError: true }
    }
  },
})

registerSkill({
  name: 'paypal_create_payout',
  description: 'Send money to a PayPal email or PayPal ID (disbursement/payout).',
  inputSchema: {
    type: 'object',
    properties: {
      recipientEmail: { type: 'string', description: 'Recipient PayPal email address' },
      amount: { type: 'string', description: 'Amount as string (e.g. "25.00")' },
      currency: { type: 'string', description: 'ISO currency code (default: USD)' },
      note: { type: 'string', description: 'Note to recipient' },
    },
    required: ['recipientEmail', 'amount'],
  },
  handler: async (input: Record<string, unknown>, ctx: AgentContext): Promise<SkillResult> => {
    try {
      // PayPal payouts use a different API — use axios for direct REST call
      const axios = (await import('axios')).default

      const clientId = getByoakValue(ctx.byoak, 'paypal', 'CLIENT_ID')!
      const clientSecret = getByoakValue(ctx.byoak, 'paypal', 'CLIENT_SECRET')!
      const environment = getByoakValue(ctx.byoak, 'paypal', 'ENVIRONMENT') ?? 'sandbox'
      const baseUrl = environment === 'live'
        ? 'https://api-m.paypal.com'
        : 'https://api-m.sandbox.paypal.com'

      // Get access token
      const tokenRes = await axios.post(
        `${baseUrl}/v1/oauth2/token`,
        'grant_type=client_credentials',
        { auth: { username: clientId, password: clientSecret } }
      )
      const accessToken = (tokenRes.data as { access_token: string }).access_token

      // Create payout
      const payoutRes = await axios.post(
        `${baseUrl}/v1/payments/payouts`,
        {
          sender_batch_header: {
            sender_batch_id: `jarvis-${Date.now()}`,
            email_subject: input.note ? String(input.note) : 'Payment from JARVIS',
          },
          items: [
            {
              recipient_type: 'EMAIL',
              amount: {
                value: String(input.amount),
                currency: String(input.currency ?? 'USD'),
              },
              receiver: String(input.recipientEmail),
              note: input.note ? String(input.note) : undefined,
            },
          ],
        },
        { headers: { Authorization: `Bearer ${accessToken}` } }
      )

      const batch = payoutRes.data as { batch_header: { payout_batch_id: string; batch_status: string } }
      return {
        output: `Payout created: ${batch.batch_header.payout_batch_id}\nStatus: ${batch.batch_header.batch_status}`,
        isError: false,
      }
    } catch (err) {
      return { output: `PayPal payout error: ${(err as Error).message}`, isError: true }
>>>>>>> e0d59e7b5270ae6d2f51bb3f447c22895f8fee54
    }
  },
})
