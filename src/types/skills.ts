import type { AgentContext } from './agent.js'

export interface SkillResult {
  output: string
  isError: boolean
  metadata?: Record<string, unknown>
}

export interface SkillDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  handler: (input: Record<string, unknown>, ctx: AgentContext) => Promise<SkillResult>
}

export interface SkillManifest {
  skills: SkillDefinition[]
}
