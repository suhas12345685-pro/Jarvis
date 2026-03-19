import type { SkillDefinition } from '../types/index.js'
import type { LLMToolDefinition } from '../llm/types.js'

const registry = new Map<string, SkillDefinition>()

export function registerSkill(def: SkillDefinition): void {
  registry.set(def.name, def)
}

export function getSkill(name: string): SkillDefinition | undefined {
  return registry.get(name)
}

export function getAllDefinitions(): SkillDefinition[] {
  return Array.from(registry.values())
}

<<<<<<< HEAD
=======
/** Convert SkillDefinition[] to the LLM-agnostic tool definition format */
>>>>>>> e0d59e7b5270ae6d2f51bb3f447c22895f8fee54
export function toLLMTools(): LLMToolDefinition[] {
  return getAllDefinitions().map(skill => ({
    name: skill.name,
    description: skill.description,
    inputSchema: skill.inputSchema,
  }))
}

<<<<<<< HEAD
=======
// Auto-register all skills by importing them
>>>>>>> e0d59e7b5270ae6d2f51bb3f447c22895f8fee54
export async function loadAllSkills(): Promise<void> {
  await Promise.all([
    import('./osTerminal.js'),
    import('./cronHeartbeat.js'),
    import('./localFileOps.js'),
    import('./visionScreen.js'),
    import('./visionCamera.js'),
    import('./headlessBrowser.js'),
    import('./apiFetcher.js'),
    import('./commsEmail.js'),
    import('./commsChannels.js'),
    import('./commsCalendar.js'),
    import('./commsDiscord.js'),
    import('./commsGChat.js'),
    import('./businessPayments.js'),
    import('./businessPaymentsRazorpay.js'),
    import('./businessPaymentsPaypal.js'),
    import('./dataAnalysis.js'),
    import('./webSearch.js'),
    import('./textTransform.js'),
<<<<<<< HEAD
    import('./emotionSkills.js'),
  ])
}

export { type SkillDefinition, type SkillResult } from '../types/skills.js'
=======
  ])
}
>>>>>>> e0d59e7b5270ae6d2f51bb3f447c22895f8fee54
