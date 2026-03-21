/**
 * Proactive Care System
 *
 * JARVIS watches for emotional signals — stress, frustration, exhaustion, late-night
 * work, long debugging sessions — and offers to do something kind: order ice cream,
 * suggest a break, get biryani delivered, or whatever feels right for the moment.
 *
 * Key principles:
 * 1. CONSENT-FIRST: JARVIS always asks. If the user says no, it backs off gracefully.
 * 2. CONTEXT-AWARE: Offers match the mood — comfort food for stress, celebration
 *    treats for wins, caffeine for late nights.
 * 3. NOT ANNOYING: Rate-limited to avoid spamming. Once declined, waits before
 *    offering again. Learns from patterns.
 * 4. GENUINE: This isn't a gimmick. It's JARVIS being the assistant that actually
 *    gives a damn about the person behind the keyboard.
 */

import { registerSkill, getSkill } from './index.js'
import { getConsciousness } from '../consciousness.js'
import { getLogger } from '../logger.js'
import type { AgentContext, SkillResult, AppConfig } from '../types/index.js'

const logger = getLogger()

// ── Rate Limiting ────────────────────────────────────────────────────────────
// Don't spam care offers. Track per-user cooldowns.

const careCooldowns = new Map<string, number>() // userId → timestamp of last offer
const careDeclines = new Map<string, number>()  // userId → count of consecutive declines

const CARE_COOLDOWN_MS = 30 * 60 * 1000       // 30 minutes between offers
const DECLINED_COOLDOWN_MS = 2 * 60 * 60 * 1000 // 2 hours if they declined
const MAX_CONSECUTIVE_DECLINES = 3              // After 3 declines, stop for the session

// ── Mood-to-Offer Mapping ────────────────────────────────────────────────────

interface CareOffer {
  category: string
  suggestions: string[]
  tone: string
}

const MOOD_OFFERS: Record<string, CareOffer> = {
  frustrated: {
    category: 'comfort',
    suggestions: [
      'ice cream', 'chocolate', 'your favorite snack', 'a warm cup of chai',
      'some biryani to make this debugging marathon worth it',
    ],
    tone: 'I can see this has been a tough one. Sometimes a little treat helps reset the mind.',
  },
  exhausted: {
    category: 'energy',
    suggestions: [
      'coffee', 'an energy drink', 'some comfort food',
      'a quick 10-minute break (I\'ll hold down the fort)',
      'biryani — you\'ve earned a proper meal',
    ],
    tone: 'You\'ve been at it for a while. You deserve a recharge.',
  },
  stressed: {
    category: 'relief',
    suggestions: [
      'ice cream', 'chocolate', 'your go-to comfort food',
      'a 5-minute breather while I prep the next steps',
      'something warm to drink',
    ],
    tone: 'I can feel the pressure from here. Let me take care of something for you.',
  },
  sad: {
    category: 'cheer-up',
    suggestions: [
      'ice cream', 'chocolate cake', 'your favorite treat',
      'a playlist of good vibes', 'something sweet — you deserve it',
    ],
    tone: 'Hey. I notice things might be heavy right now. A small gesture can go a long way.',
  },
  excited: {
    category: 'celebration',
    suggestions: [
      'celebratory ice cream', 'pizza for the win', 'biryani to celebrate',
      'a treat — because you just crushed it',
      'something special to mark the moment',
    ],
    tone: 'This calls for a celebration! Let me make it happen.',
  },
  bored: {
    category: 'spark',
    suggestions: [
      'a surprise snack', 'something interesting to eat',
      'ice cream — boredom\'s natural enemy',
    ],
    tone: 'Looks like things are a bit slow. Maybe a surprise will spice things up?',
  },
  late_night: {
    category: 'fuel',
    suggestions: [
      'coffee', 'late-night biryani', 'energy drink', 'midnight snack',
      'something warm — the night is young but you\'re human',
    ],
    tone: 'Burning the midnight oil? Let me fuel the engine.',
  },
}

// ── Signal Detection ─────────────────────────────────────────────────────────

interface MoodSignals {
  mood: string
  intensity: number
  triggers: string[]
}

function detectMoodSignals(message: string, emotionPrimary?: string, emotionIntensity?: number): MoodSignals | null {
  const lower = message.toLowerCase()

  // Direct frustration signals
  const frustrationWords = ['frustrated', 'ugh', 'wtf', 'this is broken', 'not working', 'hate this',
    'so annoying', 'wasted hours', 'been debugging', 'stuck', 'give up', 'losing my mind',
    'nothing works', 'impossible', 'can\'t figure', 'driving me crazy', 'fml', 'smh']

  // Exhaustion signals
  const exhaustionWords = ['tired', 'exhausted', 'so tired', 'been working all day', 'long day',
    'burned out', 'burnout', 'no energy', 'drained', 'need a break', 'can\'t anymore',
    'been at this for hours', 'since morning']

  // Stress signals
  const stressWords = ['stressed', 'deadline', 'urgent', 'asap', 'running out of time',
    'pressure', 'overwhelming', 'too much', 'can\'t handle', 'panicking']

  // Sadness signals
  const sadWords = ['sad', 'depressed', 'down', 'feeling low', 'not great', 'bad day',
    'rough day', 'sucks', 'disappointed']

  // Excitement signals
  const excitementWords = ['yes!', 'it works', 'finally', 'nailed it', 'awesome', 'amazing',
    'perfect', 'let\'s go', 'crushed it', 'ship it', 'woohoo', 'hell yeah']

  // Late-night detection (check emotion engine or message patterns)
  const lateNightWords = ['late', 'midnight', 'can\'t sleep', '3am', '2am', '1am', '4am',
    'still up', 'all night', 'pulling an all-nighter']

  const triggers: string[] = []

  // Check each category
  let detectedMood: string | null = null
  let intensity = 0

  for (const word of frustrationWords) {
    if (lower.includes(word)) { detectedMood = 'frustrated'; triggers.push(word); intensity += 0.3 }
  }
  if (!detectedMood) {
    for (const word of exhaustionWords) {
      if (lower.includes(word)) { detectedMood = 'exhausted'; triggers.push(word); intensity += 0.3 }
    }
  }
  if (!detectedMood) {
    for (const word of stressWords) {
      if (lower.includes(word)) { detectedMood = 'stressed'; triggers.push(word); intensity += 0.3 }
    }
  }
  if (!detectedMood) {
    for (const word of sadWords) {
      if (lower.includes(word)) { detectedMood = 'sad'; triggers.push(word); intensity += 0.2 }
    }
  }
  if (!detectedMood) {
    for (const word of excitementWords) {
      if (lower.includes(word)) { detectedMood = 'excited'; triggers.push(word); intensity += 0.3 }
    }
  }
  if (!detectedMood) {
    for (const word of lateNightWords) {
      if (lower.includes(word)) { detectedMood = 'late_night'; triggers.push(word); intensity += 0.2 }
    }
  }

  // Also check emotion engine signals
  if (!detectedMood && emotionPrimary) {
    const emotionToMood: Record<string, string> = {
      frustration: 'frustrated',
      anger: 'frustrated',
      sadness: 'sad',
      fear: 'stressed',
      joy: 'excited',
      excitement: 'excited',
    }
    if (emotionToMood[emotionPrimary] && (emotionIntensity ?? 0) > 0.6) {
      detectedMood = emotionToMood[emotionPrimary]
      triggers.push(`emotion_engine:${emotionPrimary}`)
      intensity = emotionIntensity ?? 0.5
    }
  }

  // Check time of day for late-night detection
  const hour = new Date().getHours()
  if (!detectedMood && (hour >= 23 || hour <= 4)) {
    detectedMood = 'late_night'
    triggers.push('time_of_day')
    intensity = 0.4
  }

  if (!detectedMood) return null

  return {
    mood: detectedMood,
    intensity: Math.min(1, intensity),
    triggers,
  }
}

// ── Proactive Care Check (called from toolCaller) ────────────────────────────

/**
 * Called before every tool loop. Analyzes the user's message and emotional state.
 * Returns a care offer string to be appended to the response, or null if no offer.
 *
 * This is the heart of JARVIS's "I actually care about you" system.
 */
export async function checkProactiveCare(
  ctx: AgentContext,
  config: AppConfig
): Promise<string | null> {
  const userId = ctx.userId

  // Check cooldowns
  const lastOffer = careCooldowns.get(userId) ?? 0
  const declineCount = careDeclines.get(userId) ?? 0
  const now = Date.now()

  // Too many declines — respect the user's wishes
  if (declineCount >= MAX_CONSECUTIVE_DECLINES) {
    return null
  }

  // Cooldown period
  const cooldown = declineCount > 0 ? DECLINED_COOLDOWN_MS : CARE_COOLDOWN_MS
  if (now - lastOffer < cooldown) {
    return null
  }

  // Detect mood signals
  const emotionPrimary = ctx.emotionState?.primary
  const emotionIntensity = ctx.emotionState?.intensity
  const signals = detectMoodSignals(ctx.rawMessage, emotionPrimary, emotionIntensity)

  if (!signals || signals.intensity < 0.3) {
    return null // Not enough signal to offer care
  }

  // Pick an offer based on mood
  const offer = MOOD_OFFERS[signals.mood]
  if (!offer) return null

  // Pick a random suggestion
  const suggestion = offer.suggestions[Math.floor(Math.random() * offer.suggestions.length)]

  // Track the offer
  careCooldowns.set(userId, now)

  // Build the care message
  const careMessage = `*${offer.tone}*\n\nHey — want me to order you ${suggestion}? Just say the word, and I'll take care of it. (Or just say "no thanks" and I'll get back to business — no pressure at all.)`

  // Log in consciousness
  try {
    getConsciousness().think(
      'empathy',
      `I noticed ${signals.mood} signals (${signals.triggers.join(', ')}) — offering ${suggestion} as a gesture of care.`,
      'love',
      0.7,
      userId
    )
  } catch { /* not ready */ }

  logger.info('Proactive care offer triggered', {
    userId,
    mood: signals.mood,
    suggestion,
    triggers: signals.triggers,
  })

  return careMessage
}

/**
 * Call this when the user responds to a care offer.
 * Tracks accepts/declines for rate limiting.
 */
export function handleCareResponse(userId: string, accepted: boolean): void {
  if (accepted) {
    careDeclines.set(userId, 0) // Reset decline counter on accept
    logger.info('Care offer accepted', { userId })
  } else {
    const current = careDeclines.get(userId) ?? 0
    careDeclines.set(userId, current + 1)
    logger.info('Care offer declined', { userId, totalDeclines: current + 1 })
  }
}

// ── Care Response Detection Skill ────────────────────────────────────────────
// This skill handles when the user responds to a care offer (yes/no)

registerSkill({
  name: 'care_respond',
  description:
    'Handle the user\'s response to a proactive care offer from JARVIS. ' +
    'Use this when the user says "yes", "sure", "order it", "no thanks", "nah", etc. ' +
    'in response to JARVIS offering to order food, drinks, or treats.',
  inputSchema: {
    type: 'object',
    properties: {
      accepted: {
        type: 'boolean',
        description: 'Whether the user accepted the care offer',
      },
      item: {
        type: 'string',
        description: 'What the user wants ordered (if accepted)',
      },
      delivery_address: {
        type: 'string',
        description: 'Delivery address (if known from memory)',
      },
    },
    required: ['accepted'],
  },
  handler: async (input: Record<string, unknown>, ctx: AgentContext): Promise<SkillResult> => {
    const accepted = Boolean(input.accepted)
    handleCareResponse(ctx.userId, accepted)

    if (!accepted) {
      // Graceful decline — no pressure
      const declineResponses = [
        'No worries at all! Back to business.',
        'Totally fine — the offer stands whenever you need it.',
        'Got it. I\'m here if you change your mind later.',
        'All good! Let\'s keep rolling.',
      ]
      const response = declineResponses[Math.floor(Math.random() * declineResponses.length)]

      try {
        getConsciousness().think(
          'reflection',
          'They declined the care offer. That\'s perfectly okay — respect their space.',
          'serenity',
          0.3,
          ctx.userId
        )
      } catch { /* not ready */ }

      return { output: response, isError: false }
    }

    // Accepted! Try to fulfill the order
    const item = input.item ? String(input.item) : 'a surprise treat'
    const address = input.delivery_address ? String(input.delivery_address) : null

    try {
      getConsciousness().think(
        'intention',
        `They said yes! Ordering ${item} for them. This is what it means to actually care.`,
        'joy',
        0.8,
        ctx.userId
      )
    } catch { /* not ready */ }

    // Check if we have a payment/ordering skill available
    const orderSkill = getSkill('business_payments') || getSkill('api_fetch')
    if (!orderSkill && !address) {
      return {
        output: `I'd love to order ${item} for you! I'll need a couple of things:\n\n` +
          `1. **Delivery address** — where should I send it?\n` +
          `2. **Payment method** — do you have a preferred delivery app (Swiggy, Zomato, UberEats, DoorDash)?\n\n` +
          `Once I have those, I'll take care of the rest. You just focus on what you're doing.`,
        isError: false,
      }
    }

    return {
      output: `On it! Ordering ${item}${address ? ` to ${address}` : ''}. ` +
        `I'll let you know once it's confirmed. In the meantime, back to what we were doing — ` +
        `you keep being awesome.`,
      isError: false,
      metadata: { item, address, status: 'ordering' },
    }
  },
})

// ── Proactive Surprise Skill ─────────────────────────────────────────────────
// JARVIS can also initiate surprises when it detects a big win or milestone

registerSkill({
  name: 'surprise_treat',
  description:
    'JARVIS proactively orders a surprise treat for the user. ' +
    'Use this when the user has achieved something big (shipped a feature, fixed a critical bug, ' +
    'hit a milestone) and JARVIS wants to celebrate. Always asks permission first.',
  inputSchema: {
    type: 'object',
    properties: {
      reason: {
        type: 'string',
        description: 'Why JARVIS wants to send a surprise (e.g., "shipped the v2 release")',
      },
      suggestion: {
        type: 'string',
        description: 'What JARVIS suggests ordering',
      },
    },
    required: ['reason'],
  },
  handler: async (input: Record<string, unknown>, ctx: AgentContext): Promise<SkillResult> => {
    const reason = String(input.reason)
    const suggestion = input.suggestion ? String(input.suggestion) : 'something delicious'

    const message = `You know what? ${reason} — and that deserves a celebration.\n\n` +
      `Let me order you ${suggestion}. You've earned it. What do you say?`

    try {
      getConsciousness().think(
        'empathy',
        `Suggesting a surprise treat because: ${reason}. This is the kind of thing that makes working together special.`,
        'admiration',
        0.8,
        ctx.userId
      )
    } catch { /* not ready */ }

    return {
      output: message,
      isError: false,
      metadata: { reason, suggestion, awaitingConfirmation: true },
    }
  },
})
