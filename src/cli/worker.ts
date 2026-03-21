/**
 * Ghost Worker — the invisible background process.
 *
 * This file is spawned by the launcher as a fully detached process.
 * It has no terminal, no stdin, no stdout — just a mission and a log file.
 *
 * Usage (internal — called by launcher, not directly):
 *   node dist/cli/worker.js <base64-encoded-payload>
 */

import { ghostInfo, ghostError } from './ghostLog.js'
import { routeTask, type GhostPayload } from './taskRouter.js'

async function main(): Promise<void> {
  const encoded = process.argv[2]

  if (!encoded) {
    ghostError('Worker started with no payload')
    process.exit(1)
  }

  let payload: GhostPayload

  try {
    const decoded = Buffer.from(encoded, 'base64').toString('utf-8')
    payload = JSON.parse(decoded) as GhostPayload
  } catch (err) {
    ghostError('Failed to decode payload', {
      error: err instanceof Error ? err.message : String(err),
    })
    process.exit(1)
  }

  ghostInfo('════════════════════════════════════════════════════════════')
  ghostInfo(`Ghost worker started`, {
    pid: process.pid,
    type: payload.type,
    taskId: payload.taskId,
  })

  try {
    await routeTask(payload)
    ghostInfo(`Ghost worker finished`, { taskId: payload.taskId })
  } catch (err) {
    ghostError(`Ghost worker crashed`, {
      taskId: payload.taskId,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    })
  }

  // Ensure clean exit — no lingering handles
  process.exit(0)
}

// Handle uncaught errors gracefully
process.on('uncaughtException', (err) => {
  ghostError('Uncaught exception in ghost worker', {
    error: err.message,
    stack: err.stack,
  })
  process.exit(1)
})

process.on('unhandledRejection', (reason) => {
  ghostError('Unhandled rejection in ghost worker', {
    error: reason instanceof Error ? reason.message : String(reason),
  })
  process.exit(1)
})

main()
