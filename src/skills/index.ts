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

/** Convert SkillDefinition[] to the LLM-agnostic tool definition format */
export function toLLMTools(): LLMToolDefinition[] {
  return getAllDefinitions().map(skill => ({
    name: skill.name,
    description: skill.description,
    inputSchema: skill.inputSchema,
  }))
}

// Auto-register all skills by importing them
export async function loadAllSkills(): Promise<void> {
  await Promise.all([
    // System & files
    import('./osTerminal.js'),
    import('./cronHeartbeat.js'),
    import('./localFileOps.js'),
    import('./systemInfo.js'),
    // Vision
    import('./visionScreen.js'),
    import('./visionCamera.js'),
    // Web & browser
    import('./headlessBrowser.js'),
    import('./apiFetcher.js'),
    import('./webSearch.js'),
    // Communications
    import('./commsEmail.js'),
    import('./commsChannels.js'),
    import('./commsCalendar.js'),
    import('./commsDiscord.js'),
    import('./commsGChat.js'),
    import('./notifications.js'),
    // Payments
    import('./businessPayments.js'),
    import('./businessPaymentsRazorpay.js'),
    import('./businessPaymentsPaypal.js'),
    // Data & text
    import('./dataAnalysis.js'),
    import('./textTransform.js'),
    import('./encoding.js'),
    import('./mathCrypto.js'),
    // Git
    import('./gitOps.js'),
    // Memory
    import('./memorySkills.js'),
    // Proactive
    import('./proactive.js'),
    // Meeting & calls
    import('./meetingCall.js'),
    // Skill builder (JARVIS creates tools)
    import('./skillBuilder.js'),
    // Database
    import('./database.js'),
    // Cloud storage (S3-compatible)
    import('./cloudStorage.js'),
    // Docker container management
    import('./docker.js'),
    // PDF processing
    import('./pdf.js'),
    // Translation & NLP
    import('./translate.js'),
    // Archive management
    import('./archive.js'),
    // Network diagnostics
    import('./network.js'),
    // Image processing
    import('./imageOps.js'),
    // Scheduling & timers
    import('./scheduler.js'),
    // Code snippet manager
    import('./snippet.js'),
    import('./emotionSkills.js'),
    // Consciousness & introspection
    import('./consciousnessSkills.js'),
    // Agent swarm deployment
    import('./agentSwarm.js'),
  ])

  // Load user-created custom skills from disk
  const { loadCustomSkills } = await import('./skillBuilder.js')
  await loadCustomSkills()

  // Load auto-generated skills from disk
  const { loadAutoSkills } = await import('../autoSkillGenerator.js')
  await loadAutoSkills()
}

export { type SkillDefinition, type SkillResult } from '../types/skills.js'