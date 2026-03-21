/**
 * Manus AI LLM Provider
 *
 * Manus is a task-based AI API. We POST a task, poll for completion,
 * then retrieve the result. This adapter wraps the async task flow
 * into the synchronous LLMProvider.chat() interface.
 *
 * API: POST https://api.manus.ai/v1/tasks → poll GET /v1/tasks/:id → result
 */

import type {
  LLMProvider,
  LLMChatOptions,
  LLMResponse,
  LLMStreamEvent,
} from '../types.js'

const MANUS_BASE_URL = 'https://api.manus.ai/v1'
const POLL_INTERVAL_MS = 2_000
const MAX_POLL_ATTEMPTS = 90 // 3 minutes max
const POLL_BACKOFF_FACTOR = 1.2

interface ManusTaskResponse {
  id: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  result?: { text: string }
  error?: { message: string }
}

export class ManusProvider implements LLMProvider {
  name = 'manus'
  private apiKey: string

  constructor(apiKey: string) {
    this.apiKey = apiKey
  }

  async chat(opts: LLMChatOptions): Promise<LLMResponse> {
    const axios = (await import('axios')).default

    // Build the task payload from the chat messages
    const systemPrompt = opts.system || ''
    const conversationText = opts.messages
      .map(m => `${m.role}: ${m.content}`)
      .join('\n\n')

    const taskPrompt = systemPrompt
      ? `${systemPrompt}\n\n${conversationText}`
      : conversationText

    // 1. Create the task
    const createResponse = await axios.post(
      `${MANUS_BASE_URL}/tasks`,
      {
        prompt: taskPrompt,
        model: opts.model || 'manus-1',
        max_tokens: opts.maxTokens ?? 4096,
        // Pass tool definitions if available
        ...(opts.tools && opts.tools.length > 0
          ? {
              tools: opts.tools.map(t => ({
                name: t.name,
                description: t.description,
                parameters: t.inputSchema,
              })),
            }
          : {}),
      },
      {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 30_000,
      },
    )

    const taskId: string = createResponse.data.id
    if (!taskId) {
      throw new Error('Manus API did not return a task ID')
    }

    // 2. Poll for completion with exponential backoff
    let attempts = 0
    let pollDelay = POLL_INTERVAL_MS

    while (attempts < MAX_POLL_ATTEMPTS) {
      await sleep(pollDelay)
      attempts++

      const pollResponse = await axios.get<ManusTaskResponse>(
        `${MANUS_BASE_URL}/tasks/${taskId}`,
        {
          headers: { 'Authorization': `Bearer ${this.apiKey}` },
          timeout: 15_000,
        },
      )

      const task = pollResponse.data

      if (task.status === 'completed') {
        const text = task.result?.text ?? ''
        return { text, toolCalls: [], stopReason: 'end_turn' }
      }

      if (task.status === 'failed') {
        const errMsg = task.error?.message ?? 'Task failed without error details'
        throw new Error(`Manus task failed: ${errMsg}`)
      }

      // Still pending/running — back off slightly
      pollDelay = Math.min(pollDelay * POLL_BACKOFF_FACTOR, 10_000)
    }

    throw new Error(`Manus task ${taskId} timed out after ${MAX_POLL_ATTEMPTS} poll attempts`)
  }

  async *stream(opts: LLMChatOptions): AsyncIterable<LLMStreamEvent> {
    // Manus doesn't support streaming natively — simulate with a single result
    const response = await this.chat(opts)
    yield { type: 'text_delta', text: response.text }
    yield { type: 'done', response }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
