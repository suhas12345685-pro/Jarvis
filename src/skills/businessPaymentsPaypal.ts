import { registerSkill } from './index.js'
import type { AgentContext, SkillResult } from '../types/index.js'
import { getByoakValue } from '../config.js'

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
}

registerSkill({
  name: 'paypal_create_order',
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
    }
  },
})

registerSkill({
  name: 'paypal_capture_order',
  description: 'Capture an approved PayPal order to complete payment.',
  inputSchema: {
    type: 'object',
    properties: {
      orderId: { type: 'string', description: 'PayPal order ID to capture' },
    },
    required: ['orderId'],
  },
  handler: async (input: Record<string, unknown>, ctx: AgentContext): Promise<SkillResult> => {
    try {
      const { client, paypal } = await getPaypalClient(ctx)
      const ordersController = new paypal.OrdersController(client)

      const response = await ordersController.ordersCapture({
        id: String(input.orderId),
      })

      const result = response.result
      return {
        output: `Order captured: ${result.id}\nStatus: ${result.status}`,
        isError: false,
      }
    } catch (err) {
      return { output: `PayPal capture error: ${(err as Error).message}`, isError: true }
    }
  },
})

registerSkill({
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
    }
  },
})
