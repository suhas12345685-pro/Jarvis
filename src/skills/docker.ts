/**
 * Docker skills — manage containers, images, and logs.
 * Uses the Docker CLI under the hood (requires docker in PATH).
 */
import { registerSkill } from './index.js'
import type { AgentContext, SkillResult } from '../types/index.js'
import { execSync } from 'child_process'

function dockerExec(cmd: string, timeout = 15000): string {
  try {
    return execSync(cmd, {
      timeout,
      encoding: 'utf-8',
      maxBuffer: 1024 * 1024 * 5,
    }).trim()
  } catch (err) {
    throw new Error((err as Error).message.split('\n')[0])
  }
}

registerSkill({
  name: 'docker_ps',
  description: 'List Docker containers. Shows running containers by default, or all with the all flag.',
  inputSchema: {
    type: 'object',
    properties: {
      all: { type: 'boolean', description: 'Show all containers including stopped (default: false)' },
      format: { type: 'string', description: 'Custom format string (default: table)' },
    },
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    try {
      const flags = input.all ? '-a' : ''
      const format = input.format ? `--format '${String(input.format).replace(/'/g, '')}'` : '--format "table {{.ID}}\\t{{.Names}}\\t{{.Image}}\\t{{.Status}}\\t{{.Ports}}"'
      const output = dockerExec(`docker ps ${flags} ${format}`)
      return { output: output || 'No containers found', isError: false }
    } catch (err) {
      return { output: `Docker error: ${(err as Error).message}`, isError: true }
    }
  },
})

registerSkill({
  name: 'docker_logs',
  description: 'Get logs from a Docker container.',
  inputSchema: {
    type: 'object',
    properties: {
      container: { type: 'string', description: 'Container name or ID' },
      tail: { type: 'number', description: 'Number of lines from the end (default: 100)' },
      since: { type: 'string', description: 'Show logs since timestamp (e.g., "10m", "2h", "2024-01-01")' },
    },
    required: ['container'],
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    try {
      const container = String(input.container).replace(/[^a-zA-Z0-9_.\-]/g, '')
      const tail = Number(input.tail || 100)
      const since = input.since ? `--since ${String(input.since).replace(/[^a-zA-Z0-9:\-. ]/g, '')}` : ''
      const output = dockerExec(`docker logs --tail ${tail} ${since} ${container}`, 30000)
      return { output: output || '(no logs)', isError: false }
    } catch (err) {
      return { output: `Docker logs error: ${(err as Error).message}`, isError: true }
    }
  },
})

registerSkill({
  name: 'docker_start',
  description: 'Start a stopped Docker container.',
  inputSchema: {
    type: 'object',
    properties: {
      container: { type: 'string', description: 'Container name or ID' },
    },
    required: ['container'],
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    try {
      const container = String(input.container).replace(/[^a-zA-Z0-9_.\-]/g, '')
      const output = dockerExec(`docker start ${container}`)
      return { output: `Started container: ${output}`, isError: false }
    } catch (err) {
      return { output: `Docker start error: ${(err as Error).message}`, isError: true }
    }
  },
})

registerSkill({
  name: 'docker_stop',
  description: 'Stop a running Docker container.',
  inputSchema: {
    type: 'object',
    properties: {
      container: { type: 'string', description: 'Container name or ID' },
      timeout: { type: 'number', description: 'Seconds to wait before force-killing (default: 10)' },
    },
    required: ['container'],
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    try {
      const container = String(input.container).replace(/[^a-zA-Z0-9_.\-]/g, '')
      const t = Number(input.timeout || 10)
      const output = dockerExec(`docker stop -t ${t} ${container}`)
      return { output: `Stopped container: ${output}`, isError: false }
    } catch (err) {
      return { output: `Docker stop error: ${(err as Error).message}`, isError: true }
    }
  },
})

registerSkill({
  name: 'docker_exec',
  description: 'Execute a command inside a running Docker container.',
  inputSchema: {
    type: 'object',
    properties: {
      container: { type: 'string', description: 'Container name or ID' },
      command: { type: 'string', description: 'Command to execute' },
      workdir: { type: 'string', description: 'Working directory inside the container' },
    },
    required: ['container', 'command'],
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    try {
      const container = String(input.container).replace(/[^a-zA-Z0-9_.\-]/g, '')
      const command = String(input.command)
      const workdir = input.workdir ? `-w '${String(input.workdir).replace(/'/g, '')}'` : ''
      const output = dockerExec(`docker exec ${workdir} ${container} ${command}`, 30000)
      return { output: output || '(no output)', isError: false }
    } catch (err) {
      return { output: `Docker exec error: ${(err as Error).message}`, isError: true }
    }
  },
})

registerSkill({
  name: 'docker_images',
  description: 'List Docker images on the host.',
  inputSchema: {
    type: 'object',
    properties: {
      filter: { type: 'string', description: 'Filter by reference (e.g., "nginx", "myapp:latest")' },
    },
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    try {
      const filter = input.filter ? `--filter reference='${String(input.filter).replace(/'/g, '')}'` : ''
      const output = dockerExec(`docker images ${filter} --format "table {{.Repository}}\\t{{.Tag}}\\t{{.ID}}\\t{{.Size}}\\t{{.CreatedSince}}"`)
      return { output: output || 'No images found', isError: false }
    } catch (err) {
      return { output: `Docker images error: ${(err as Error).message}`, isError: true }
    }
  },
})
