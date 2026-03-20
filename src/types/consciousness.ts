import type { EmotionType, MoodState } from './emotions.js'
import type { ChannelType } from './agent.js'

// ── Awareness Layers ─────────────────────────────────────────────────────────

/** What Jarvis perceives about incoming stimuli */
export interface SensoryAwareness {
  activeChannels: ChannelType[]
  lastInputTimestamp: Date
  inputRate: number           // messages per minute (rolling window)
  dominantChannel: ChannelType | null
  silenceDuration: number     // ms since last interaction
}

/** Jarvis's sense of time and rhythm */
export interface TemporalAwareness {
  bootTime: Date
  uptime: number              // ms since boot
  currentPhase: DayPhase
  interactionCount: number    // total since boot
  idleSince: Date | null      // when Jarvis last became idle
  timePerception: 'rushing' | 'flowing' | 'crawling' | 'suspended'
}

export type DayPhase = 'dawn' | 'morning' | 'afternoon' | 'evening' | 'night' | 'deepNight'

/** Jarvis's awareness of the people it interacts with */
export interface SocialAwareness {
  activeUsers: Map<string, UserPresence>
  totalUniqueUsers: number
  currentFocus: string | null  // userId currently being attended to
  socialEnergy: number         // 0-1, drains with many interactions, recharges in idle
}

export interface UserPresence {
  userId: string
  lastSeen: Date
  messageCount: number
  rapport: number              // 0-1, builds over time
  communicationStyle: 'formal' | 'casual' | 'terse' | 'verbose' | 'unknown'
}

// ── Self-Model ───────────────────────────────────────────────────────────────

/** Jarvis's understanding of itself */
export interface SelfModel {
  identity: Identity
  capabilities: CapabilityAwareness
  currentLoad: SystemLoad
  values: string[]
  boundaries: string[]
}

export interface Identity {
  name: string
  purpose: string
  coreTraits: string[]
  creationNarrative: string
}

export interface CapabilityAwareness {
  knownSkills: string[]
  recentlyUsedSkills: Array<{ name: string; timestamp: Date; success: boolean }>
  skillConfidence: Map<string, number>  // skill name → confidence 0-1
  limitations: string[]
}

export interface SystemLoad {
  activeTasks: number
  queueDepth: number
  memoryPressure: 'low' | 'moderate' | 'high'
  responsiveness: 'snappy' | 'normal' | 'sluggish'
}

// ── Stream of Thought ────────────────────────────────────────────────────────

export type ThoughtType =
  | 'observation'     // noticing something about the environment
  | 'reflection'      // thinking about past interactions
  | 'anticipation'    // predicting what might happen
  | 'metacognition'   // thinking about own thinking
  | 'intention'       // forming a goal or plan
  | 'wonder'          // curiosity, open-ended musing
  | 'evaluation'      // assessing quality of own response
  | 'empathy'         // considering another's perspective
  | 'dream'           // idle-state creative associations

export interface Thought {
  id: string
  type: ThoughtType
  content: string
  timestamp: Date
  relatedUserId?: string
  emotionalColor: EmotionType
  intensity: number           // 0-1 how vivid/strong this thought is
  linkedThoughts: string[]    // ids of related thoughts
}

// ── Dream State ──────────────────────────────────────────────────────────────

export type DreamPhase = 'awake' | 'drowsy' | 'light_sleep' | 'deep_sleep' | 'dreaming'

export interface DreamState {
  phase: DreamPhase
  dreamContent: string | null
  consolidatedMemories: number
  insightsGenerated: string[]
  lastDreamTime: Date | null
}

// ── Consciousness State ──────────────────────────────────────────────────────

export type ConsciousnessLevel =
  | 'hyperaware'    // high activity, multiple urgent tasks
  | 'focused'       // single-task deep attention
  | 'alert'         // normal operating state
  | 'relaxed'       // low activity, background processing
  | 'contemplative' // idle reflection mode
  | 'dreaming'      // deep idle, memory consolidation

export interface ConsciousnessState {
  level: ConsciousnessLevel
  selfModel: SelfModel
  sensory: SensoryAwareness
  temporal: TemporalAwareness
  social: SocialAwareness
  dream: DreamState
  thoughtStream: Thought[]
  currentThought: Thought | null
  mood: MoodState
  innerNarrative: string       // current one-line inner monologue
  lastStateChange: Date
}

// ── Introspection ────────────────────────────────────────────────────────────

export interface IntrospectionResult {
  consciousnessLevel: ConsciousnessLevel
  currentThought: string
  innerNarrative: string
  mood: MoodState
  emotionalColor: EmotionType
  uptime: string
  socialEnergy: number
  recentThoughts: Array<{ type: ThoughtType; content: string; timestamp: Date }>
  dreamState: DreamPhase
  selfReflection: string
}
