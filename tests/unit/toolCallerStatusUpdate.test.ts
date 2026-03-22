import { describe, it, expect, vi, beforeEach } from 'vitest'

// Create a mock router.js
vi.mock('../../src/router.js', () => ({
  jarvisEvents: {
    emit: vi.fn(),
  }
}))

import { withSkillStatusUpdate } from '../../src/toolCaller.js'
import { AgentContext } from '../../src/types/index.js'
import { jarvisEvents } from '../../src/router.js'

describe('withSkillStatusUpdate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  it('should not emit status_update if skill completes before 2000ms', async () => {
    const handler = async () => {
      return new Promise(resolve => setTimeout(() => resolve('fast'), 1000))
    }
    const ctx = { userId: 'u1', threadId: 't1' } as AgentContext

    const promise = withSkillStatusUpdate(handler, 'fast_tool')({}, ctx)
    await vi.advanceTimersByTimeAsync(1000)

    const res = await promise
    expect(res).toBe('fast')
    expect(jarvisEvents.emit).not.toHaveBeenCalled()
  })

  it('should emit status_update if skill takes longer than 2000ms', async () => {
    const handler = async () => {
      return new Promise(resolve => setTimeout(() => resolve('slow'), 3000))
    }
    const ctx = { userId: 'u1', threadId: 't1' } as AgentContext

    const promise = withSkillStatusUpdate(handler, 'slow_tool')({}, ctx)

    // Advance past the 2000ms threshold
    await vi.advanceTimersByTimeAsync(2500)

    expect(jarvisEvents.emit).toHaveBeenCalledWith('status_update', {
      userId: 'u1',
      threadId: 't1',
      tool: 'slow_tool',
      message: 'Still executing slow_tool...'
    })

    // Complete the skill
    await vi.advanceTimersByTimeAsync(1000)

    const res = await promise
    expect(res).toBe('slow')
  })
})
