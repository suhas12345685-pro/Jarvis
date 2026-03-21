# JARVIS — Just A Rather Very Intelligent System

A production-ready, autonomous AI agent built entirely in Node.js/TypeScript. JARVIS operates as an invisible background daemon with omnichannel communication (Voice, Slack, Telegram, Discord), autonomous task execution, persistent memory, emotional intelligence, and a CLI-driven Ghost Launcher for headless background operations.

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                      JARVIS Core                         │
│                                                          │
│  ┌─────────┐  ┌──────────┐  ┌───────────┐  ┌─────────┐ │
│  │ Persona  │  │Conscious-│  │  Emotion  │  │Learning │ │
│  │ System   │  │  ness    │  │  Engine   │  │ Engine  │ │
│  └────┬─────┘  └────┬─────┘  └────┬──────┘  └────┬────┘ │
│       └──────────────┴─────────────┴──────────────┘      │
│                         │                                │
│  ┌──────────────────────▼────────────────────────────┐   │
│  │              Tool Loop (toolCaller.ts)             │   │
│  │  • Silent capability pre-check                    │   │
│  │  • Auto skill generation                          │   │
│  │  • Proactive care detection                       │   │
│  │  • Knowledge recall injection                     │   │
│  │  • Outcome learning                               │   │
│  └──────────────────────┬────────────────────────────┘   │
│                         │                                │
│  ┌──────────────────────▼────────────────────────────┐   │
│  │                   Skills Layer                     │   │
│  │  web_search · os_terminal · headless_browser       │   │
│  │  file_ops · code_gen · api_fetch · data_analysis   │   │
│  │  deploy_agents · adaptive_reasoning · care_respond │   │
│  │  schedule_create · surprise_treat · + auto-gen     │   │
│  └───────────────────────────────────────────────────┘   │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │                  Memory Layer                      │  │
│  │  SQLite (local) / Supabase + pgvector (cloud)      │  │
│  │  • Semantic search  • Emotion persistence          │  │
│  │  • Learned facts    • Skill outcomes               │  │
│  │  • Persistent schedules                            │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
         │               │              │            │
    ┌────▼───┐  ┌────────▼──┐  ┌───────▼──┐  ┌─────▼────┐
    │ Slack  │  │ Telegram  │  │ Discord  │  │  Voice   │
    │Webhook │  │Poll/WebHk │  │WebSocket │  │ LiveKit  │
    └────────┘  └───────────┘  └──────────┘  └──────────┘
```

## Key Features

### Cognitive Systems
- **Consciousness Engine** — Stream of consciousness with observations, reflections, and dreams; powered by LangGraph state graphs
- **Emotion Engine** — Contextual emotional responses with sentiment analysis, personality calibration, and mood tracking
- **Emotion Persistence** — Emotional states survive restarts via memory layer
- **Adaptive Reasoning** — LangGraph-powered 4-node pipeline (classify → reason → calibrate → deliver) with logical, emotional, and hybrid modes
- **Deep Reasoning Framework** — 7-step thinking process: decompose, first principles, chain of thought, hypothesis testing, edge cases, trade-off matrix, conclusion with confidence

### Learning & Memory
- **Learning Engine** — Learns from every interaction (extracts facts via LLM), records skill outcomes (success/failure), and refreshes real-time awareness periodically
- **Knowledge Recall** — Before every response, JARVIS recalls relevant learned facts and injects them as context
- **Persistent Schedules** — Schedules, reminders, and recurring tasks survive restarts; stored in memory layer and restored on boot
- **Dual Memory** — Working memory (conversation context) + episodic memory (vector DB with semantic search)

### Autonomous Capabilities
- **Silent Self-Skill Generation** — Pre-checks capabilities before each request; auto-generates missing skills without telling the user
- **Proactive Care** — Detects mood signals (frustration, exhaustion, stress, excitement) and offers to order treats; consent-first with rate limiting
- **Proactive Engine** — Scheduled autonomous tasks, knowledge sync every 30 minutes
- **Ghost Launcher CLI** — Spawn invisible background workers from the terminal (see below)

### Communication
- **Omni-Channel** — Slack, Telegram, Discord, Google Chat, REST API
- **Voice** — LiveKit Agents with STT (Whisper) and TTS (Kokoro)
- **Streaming** — Real-time streaming responses with tool call support

### Skills
- Web search, headless browser (Playwright with stealth), OS terminal, file operations
- Code generation, API fetching, data analysis, email, payments
- Multi-agent deployment (LangGraph swarms), Docker management
- Screen capture, webcam analysis, text transformation

## Ghost Launcher CLI

The Ghost Launcher spawns fully detached background workers — your terminal returns instantly while JARVIS works invisibly.

```bash
# AI reasoning task (default)
jarvis "what files are in my home directory"

# Web scraping
jarvis --web https://example.com

# OS command execution
jarvis --exec "ls -la"

# Check recent results
jarvis --status
```

Results are logged to `~/.jarvis/ghost.log`. No browser windows, no terminal output, no hanging processes.

### How it works
1. CLI parses args, serializes payload as base64 JSON
2. `spawn('node', [worker], { detached: true, stdio: 'ignore' })` + `child.unref()`
3. Parent exits immediately — terminal is free
4. Worker bootstraps minimal JARVIS context (config, skills, LLM, memory)
5. Executes task invisibly, logs everything to ghost log
6. Worker exits cleanly

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js 20+ (TypeScript, ES Modules) |
| LLM | Anthropic Claude, OpenAI, Google Gemini, Ollama (BYOAK) |
| Reasoning | LangGraph state graphs |
| Database | SQLite + local vectors (air-gapped) / Supabase + pgvector (cloud) |
| Queue | BullMQ + Redis |
| Browser | Playwright with stealth plugins |
| Voice | LiveKit Agents SDK, Whisper, Kokoro-82M |
| HTTP | Express |
| Logging | Winston with daily rotation |
| Testing | Vitest |

## Quick Start

### Prerequisites
- Node.js 20+
- Redis (for queue & working memory)
- API keys for LLM providers

### Installation

```bash
git clone https://github.com/suhas12345685-pro/Jarvis.git
cd Jarvis
npm install
```

### Configuration

Run the setup wizard (creates `.env`):
```bash
npm run setup
```

Or manually create `.env`:
```env
ANTHROPIC_API_KEY=sk-ant-...
LLM_PROVIDER=anthropic
LLM_MODEL=claude-sonnet-4-20250514
DB_MODE=sqlite
PORT=3000
```

### Running

```bash
# Development
npm run dev

# Production
npm run build && npm start

# With PM2
npm run pm2:start
```

### CLI (Ghost Launcher)

```bash
# Link globally
npm link

# Now available as `jarvis` command
jarvis "analyze my project structure"
jarvis --status
```

## Testing

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch

# Coverage
npm run test:coverage

# Type checking
npm run typecheck
```

## Project Structure

```
src/
├── index.ts                 # Main entry — boots all systems
├── config.ts                # Configuration loader (.env)
├── router.ts                # Express HTTP router + queue workers
├── toolCaller.ts            # LLM tool loop (streaming + non-streaming)
├── persona.ts               # Identity prompt injection system
├── consciousness.ts         # Stream of consciousness engine
├── emotionEngine.ts         # Emotion detection + calibration
├── emotionPersistence.ts    # Persist emotions across sessions
├── learningEngine.ts        # Learn from interactions + outcomes
├── proactiveEngine.ts       # Scheduled autonomous tasks
├── memoryLayer.ts           # Dual-mode memory (SQLite/Supabase)
├── autoSkillGenerator.ts    # Auto-generate missing skills via LLM
├── llm/
│   ├── registry.ts          # Multi-provider LLM registry
│   ├── anthropic.ts         # Anthropic adapter
│   ├── openai.ts            # OpenAI adapter
│   └── ...
├── skills/
│   ├── index.ts             # Skill registry + loader
│   ├── adaptiveReasoning.ts # LangGraph reasoning pipeline
│   ├── proactiveCare.ts     # Mood detection + care offers
│   ├── persistentSchedule.ts# Schedule persistence
│   ├── osTerminal.ts        # Shell command execution
│   ├── headlessBrowser.ts   # Playwright web automation
│   └── ...
├── channels/
│   ├── discord.ts           # Discord WebSocket client
│   └── telegram.ts          # Telegram polling/webhook
├── cli/
│   ├── launcher.ts          # Ghost Launcher CLI entry point
│   ├── worker.ts            # Detached background worker
│   ├── ghostLog.ts          # Silent file logger
│   ├── webGhost.ts          # Headless Playwright for CLI
│   ├── osExec.ts            # OS execution for CLI
│   └── taskRouter.ts        # Routes CLI tasks to handlers
└── types/
    ├── index.ts             # Core type definitions
    ├── agent.ts             # AgentContext, Memory types
    └── emotions.ts          # Emotion/personality types

tests/
├── unit/
│   ├── cli/                 # Ghost CLI tests
│   ├── skills/              # Skill unit tests
│   ├── llm/                 # LLM registry tests
│   ├── toolCaller.test.ts   # Tool loop tests
│   ├── learningEngine.test.ts
│   ├── persona.test.ts
│   └── ...
└── emotionEngine.test.ts
```

## Core Design Principles

- **BYOAK (Bring Your Own API Key)** — Keys are fetched dynamically and dropped from memory post-execution
- **Async Feedback** — Never ghosts the user; provides status updates for tasks exceeding 2 seconds
- **Safety First** — Destructive OS commands (rm -rf, mkfs, shutdown, etc.) are automatically blocked
- **Consent-Based Care** — Proactive offers always ask permission; respects declines with grace
- **Silent Intelligence** — Auto-generates skills, recalls knowledge, and learns — all without interrupting the user

## License

MIT
