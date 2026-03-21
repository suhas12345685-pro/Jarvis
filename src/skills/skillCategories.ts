/**
 * Semantic Skill Categories — Context Window Diet
 *
 * Instead of dumping all 45+ tools into every LLM call (bloating the context
 * window by thousands of tokens), we group skills into logical categories.
 * An intent classifier selects only the relevant category(ies) before the
 * tool loop runs, so the LLM only sees the tools it actually needs.
 *
 * Categories:
 *   core       — always injected (memory, reasoning, introspection, care)
 *   web        — browser, scraping, search, API calls
 *   os         — terminal, files, system info, cron
 *   comms      — email, Slack, Discord, Telegram, Google Chat, notifications
 *   business   — payments (Stripe/Razorpay/PayPal), meetings
 *   data       — CSV analysis, text transform, encoding, math/crypto
 *   devops     — git, database, docker, cloud storage, network
 *   media      — images, PDFs, archives, screenshots, webcam
 *   planning   — scheduling, timers, code snippets, translation
 *   agents     — multi-agent swarm, adaptive reasoning, skill builder
 */

import type { LLMToolDefinition } from '../llm/types.js'
import { getAllDefinitions, getSkill } from './index.js'

// ── Category Definitions ────────────────────────────────────────────────────

export type SkillCategory =
  | 'core'
  | 'web'
  | 'os'
  | 'comms'
  | 'business'
  | 'data'
  | 'devops'
  | 'media'
  | 'planning'
  | 'agents'

/** Map every registered skill name → its category */
const SKILL_CATEGORY_MAP: Record<string, SkillCategory> = {
  // ── Core (always available) ───────────────────────────────────────────
  memory_store: 'core',
  memory_recall: 'core',
  detect_emotion: 'core',
  set_personality: 'core',
  consciousness_introspect: 'core',
  care_respond: 'core',
  surprise_treat: 'core',
  adaptive_reasoning: 'core',
  schedule_create: 'core',
  schedule_delete: 'core',
  schedule_list: 'core',
  remember_for_later: 'core',

  // ── Web & Browser ─────────────────────────────────────────────────────
  headless_browser: 'web',
  api_fetch: 'web',
  web_search: 'web',

  // ── OS & Files ────────────────────────────────────────────────────────
  os_terminal: 'os',
  local_file_read: 'os',
  local_file_write: 'os',
  local_file_search: 'os',
  cron_heartbeat: 'os',
  system_info: 'os',

  // ── Communications ────────────────────────────────────────────────────
  send_email: 'comms',
  read_email: 'comms',
  calendar_list: 'comms',
  calendar_create: 'comms',
  slack_send: 'comms',
  slack_update: 'comms',
  discord_send: 'comms',
  discord_reply: 'comms',
  gchat_send: 'comms',
  notify_slack: 'comms',
  notify_webhook: 'comms',

  // ── Business & Payments ───────────────────────────────────────────────
  stripe_list_charges: 'business',
  stripe_create_payment: 'business',
  paypal_create_order: 'business',
  razorpay_create_order: 'business',
  razorpay_list_orders: 'business',
  meeting_join: 'business',
  meeting_answer: 'business',
  meeting_end: 'business',
  meeting_notes: 'business',

  // ── Data & Text ───────────────────────────────────────────────────────
  data_parse_csv: 'data',
  data_filter: 'data',
  data_statistics: 'data',
  text_summarize: 'data',
  encode_base64: 'data',
  decode_base64: 'data',
  encode_url: 'data',
  decode_url: 'data',
  decode_jwt: 'data',
  math_evaluate: 'data',
  math_convert_units: 'data',
  crypto_hash: 'data',
  crypto_encrypt: 'data',
  crypto_decrypt: 'data',

  // ── DevOps ────────────────────────────────────────────────────────────
  git_status: 'devops',
  git_log: 'devops',
  git_commit: 'devops',
  git_push: 'devops',
  git_pull: 'devops',
  git_diff: 'devops',
  git_branch: 'devops',
  db_query: 'devops',
  db_schema: 'devops',
  docker_list: 'devops',
  docker_logs: 'devops',
  docker_inspect: 'devops',
  cloud_storage_list: 'devops',
  cloud_storage_upload: 'devops',
  cloud_storage_download: 'devops',
  network_dns: 'devops',
  network_ping: 'devops',
  network_ssl: 'devops',
  network_port: 'devops',

  // ── Media & Documents ─────────────────────────────────────────────────
  image_resize: 'media',
  image_convert: 'media',
  qr_generate: 'media',
  pdf_extract: 'media',
  pdf_generate: 'media',
  archive_create: 'media',
  archive_extract: 'media',
  vision_screen: 'media',
  vision_camera: 'media',

  // ── Planning & Utilities ──────────────────────────────────────────────
  timezone_convert: 'planning',
  set_reminder: 'planning',
  set_timer: 'planning',
  translate_text: 'planning',
  detect_language: 'planning',
  analyze_sentiment: 'planning',
  snippet_save: 'planning',
  snippet_search: 'planning',
  snippet_list: 'planning',
  snippet_run: 'planning',

  // ── Multi-Agent & Meta ────────────────────────────────────────────────
  deploy_agents: 'agents',
  create_skill: 'agents',
  update_skill: 'agents',
  delete_skill: 'agents',
  proactive_create: 'agents',
  proactive_list: 'agents',
  proactive_toggle: 'agents',
  proactive_delete: 'agents',
}

// ── Intent Classifier ────────────────────────────────────────────────────────

/** Regex-based intent patterns → categories they activate */
const INTENT_PATTERNS: Array<{ pattern: RegExp; categories: SkillCategory[] }> = [
  // Web
  { pattern: /\b(browse|scrape|web\s*search|google|fetch|http|url|website|page|crawl|api\s*call|rest\s*api|endpoint)\b/i, categories: ['web'] },
  // OS
  { pattern: /\b(terminal|shell|bash|command|exec|file|folder|directory|ls|cat|mkdir|rm|mv|cp|cron|disk|cpu|memory|process|system\s*info)\b/i, categories: ['os'] },
  // Comms
  { pattern: /\b(email|send\s*mail|slack|discord|telegram|gchat|google\s*chat|notify|notification|message|calendar|meeting\s*invite)\b/i, categories: ['comms'] },
  // Business
  { pattern: /\b(payment|stripe|paypal|razorpay|invoice|charge|order|billing|meeting|call|conference)\b/i, categories: ['business'] },
  // Data
  { pattern: /\b(csv|data|statistics|summarize|summary|encode|decode|base64|jwt|hash|encrypt|decrypt|math|calculate|convert\s*unit)\b/i, categories: ['data'] },
  // DevOps
  { pattern: /\b(git|commit|push|pull|branch|merge|database|sql|query|docker|container|deploy|cloud|s3|storage|upload|download|dns|ping|ssl|port|network)\b/i, categories: ['devops'] },
  // Media
  { pattern: /\b(image|photo|picture|resize|screenshot|webcam|camera|pdf|archive|zip|tar|qr\s*code|vision)\b/i, categories: ['media'] },
  // Planning
  { pattern: /\b(schedule|remind|timer|countdown|timezone|translate|translation|language|snippet|code\s*snippet)\b/i, categories: ['planning'] },
  // Agents
  { pattern: /\b(agent|swarm|multi-agent|deploy\s*agent|create\s*skill|build\s*tool|custom\s*tool|proactive|autonomous)\b/i, categories: ['agents'] },
]

/**
 * Classify a user message into relevant skill categories using fast regex.
 * Returns 'core' plus any matched categories.
 * If nothing matches, returns ALL categories (safe fallback).
 */
export function classifyIntent(message: string): SkillCategory[] {
  const matched = new Set<SkillCategory>(['core']) // core always included

  for (const { pattern, categories } of INTENT_PATTERNS) {
    if (pattern.test(message)) {
      for (const cat of categories) matched.add(cat)
    }
  }

  // If only 'core' matched, the message is ambiguous — include everything
  if (matched.size === 1) {
    return ['core', 'web', 'os', 'comms', 'business', 'data', 'devops', 'media', 'planning', 'agents']
  }

  return Array.from(matched)
}

/**
 * Given a set of categories, return only the LLM tool definitions that
 * belong to those categories. Unknown skills default to being included
 * (safe fallback for auto-generated or custom skills).
 */
export function getToolsForCategories(categories: SkillCategory[]): LLMToolDefinition[] {
  const catSet = new Set(categories)
  const allSkills = getAllDefinitions()

  return allSkills
    .filter(skill => {
      const cat = SKILL_CATEGORY_MAP[skill.name]
      // Unknown skills (auto-generated, custom) → include if 'agents' is active
      // or if ALL categories are requested (ambiguous intent)
      if (!cat) {
        return catSet.has('agents') || categories.length >= 10
      }
      return catSet.has(cat)
    })
    .map(skill => ({
      name: skill.name,
      description: skill.description,
      inputSchema: skill.inputSchema,
    }))
}

/**
 * Get category for a specific skill name.
 * Returns undefined for unknown/auto-generated skills.
 */
export function getSkillCategory(skillName: string): SkillCategory | undefined {
  return SKILL_CATEGORY_MAP[skillName]
}

/**
 * Register a new skill→category mapping (for auto-generated skills).
 */
export function registerSkillCategory(skillName: string, category: SkillCategory): void {
  SKILL_CATEGORY_MAP[skillName] = category
}

/**
 * Get a human-readable summary of which categories were selected and
 * how many tools each contributes. Useful for logging/debugging.
 */
export function summarizeSelection(categories: SkillCategory[]): string {
  const tools = getToolsForCategories(categories)
  return `[${categories.join(', ')}] → ${tools.length} tools`
}
