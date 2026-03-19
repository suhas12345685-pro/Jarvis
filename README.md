<<<<<<< HEAD
# JARVIS - Autonomous AI Agent

A production-ready, highly autonomous, and omnipresent AI agent built entirely in Node.js/TypeScript. JARVIS operates as an invisible background daemon, acting dynamically via omnichannel inputs while autonomously managing local OS resources and web interactions.

## Features

### Core Capabilities
- **Omni-Channel Communication**: Telegram, Discord, Slack, Google Chat, Voice (LiveKit)
- **Vision & Awareness**: Screen capture, webcam analysis
- **File Operations**: Read, write, search local filesystem
- **Terminal Control**: Execute shell commands with safety validation
- **Web Automation**: Headless browser with stealth mode
- **Emotion System**: Contextual emotional responses with sentiment analysis

### Architecture Highlights
- **BYOAK (Bring Your Own API Key)**: Secure, stateless execution - keys never stored
- **Dual Memory**: Working memory (Redis) + Episodic memory (Vector DB)
- **Event-Driven**: Non-blocking async I/O for concurrent operations
- **Daemonized**: Runs as background service via PM2

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

Run the interactive setup wizard:

```bash
npm run setup
```

This will prompt for:
- LLM Provider (Anthropic, OpenAI, Gemini, etc.)
- Database mode (SQLite for local, Supabase for cloud)
- Channel configurations (Telegram, Discord, Slack, etc.)

### Starting JARVIS

```bash
# Development
npm run dev

# Production (PM2)
npm run pm2:start
```

## Configuration

### Environment Variables (.env)

All configuration is via `.env` file. Generate one with `npm run setup` or create manually:

```env
# LLM Configuration
LLM_PROVIDER=anthropic
LLM_MODEL=claude-sonnet-4-6
ANTHROPIC_API_KEY=sk-ant-...

# BYOAK API Keys (Bring Your Own API Keys)
BYOAK_TELEGRAM_BOT_TOKEN=123456:ABC...
BYOAK_TELEGRAM_WEBHOOK_SECRET=your-secret
BYOAK_SLACK_BOT_TOKEN=xoxb-...
BYOAK_SLACK_SIGNING_SECRET=your-secret
BYOAK_DISCORD_BOT_TOKEN=your-token
BYOAK_GCHAT_SERVICE_ACCOUNT_KEY={"type":"service_account",...}
BYOAK_STRIPE_SECRET_KEY=sk_live_...
BYOAK_RAZORPAY_KEY_ID=your-key-id
BYOAK_RAZORPAY_KEY_SECRET=your-secret
BYOAK_PAYPAL_CLIENT_ID=your-client-id
BYOAK_PAYPAL_CLIENT_SECRET=your-secret
BYOAK_OPENAI_API_KEY=sk-...
BYOAK_GEMINI_API_KEY=your-key

# Database
DB_MODE=sqlite
SQLITE_PATH=~/.jarvis/jarvis.db
# Or for cloud:
# DB_MODE=supabase
# SUPABASE_URL=https://xxx.supabase.co
# SUPABASE_SERVICE_KEY=your-service-key

# Redis
REDIS_URL=redis://localhost:6379

# Server
PORT=3000
LOG_PATH=~/.jarvis/logs/app.log
```

### BYOAK Architecture

JARVIS uses a **Bring Your Own API Key** architecture:
- API keys are stored in `.env` with `BYOAK_` prefix
- Keys are fetched at runtime, never hardcoded
- Post-execution, keys are dropped from memory
- Supports multiple services per platform (e.g., multiple payment providers)

Format: `BYOAK_{SERVICE}_{KEY_NAME}=value`

## Skills Registry

JARVIS has modular "skill" modules in `src/skills/`:

### System & OS Control
| Skill | Description |
|-------|-------------|
| `osTerminal` | Execute shell commands |
| `cronHeartbeat` | Schedule recurring tasks |
| `localFileOps` | File read/write/search |

### Vision & Awareness
| Skill | Description |
|-------|-------------|
| `visionScreen` | Capture desktop screenshots |
| `visionCamera` | Capture webcam frames |

### Web & Automation
| Skill | Description |
|-------|-------------|
| `headlessBrowser` | Web navigation with Playwright |
| `apiFetcher` | REST/GraphQL API client |
| `webSearch` | Search the web |

### Communications
| Skill | Description |
|-------|-------------|
| `commsEmail` | Email via SMTP/IMAP |
| `commsChannels` | Multi-channel messaging |
| `commsCalendar` | Google/iCal calendar |
| `commsDiscord` | Discord bot interface |
| `commsGChat` | Google Chat integration |

### Business
| Skill | Description |
|-------|-------------|
| `businessPayments` | Stripe, Razorpay, PayPal |
| `dataAnalysis` | CSV/JSON analysis |

## Emotion System

JARVIS has an emotion system that provides contextual, empathetic responses.

### Emotion Types
- Primary emotions: Joy, Sadness, Anger, Fear, Surprise, Trust, Anticipation, Love, etc.
- Mood states: Excited, Happy, Content, Neutral, Worried, Sad, Frustrated, Angry, Overwhelmed

### Features
- **Sentiment Analysis**: Detects emotional tone from user messages
- **Empathetic Responses**: Automatically adds contextual emotional prefixes/suffixes
- **Voice Modulation**: Adjusts TTS pitch/speed based on emotion
- **Personality Learning**: Adapts to user communication style over time
- **Long-term Memory**: Stores emotional context for future interactions

### Emotion Endpoints
```
GET /api/emotions/:userId
```

Returns current emotion state, personality profile, and emotional trend.

## API Reference

### Message API
```
POST /api/message
Content-Type: application/json

{
  "userId": "user-123",
  "message": "Hello!"
}
```

Response:
```json
{
  "result": "Hello! 😊 How can I help you today?",
  "emotion": "joy",
  "mood": "happy"
}
```

### Health Check
```
GET /health
```

### Emotion Query
```
GET /api/emotions/:userId
```

## Webhooks

### Telegram
Set webhook: `https://your-domain.com/webhooks/telegram`

### Slack
Set webhook: `https://your-domain.com/webhooks/slack`

### Google Chat
Set webhook: `https://your-domain.com/webhooks/gchat`

## Development

```bash
# Run tests
npm test

# Watch mode
npm run test:watch

# Lint
npm run lint

# Type check
npm run typecheck

# Format
npm run format
```

## Project Structure

```
Jarvis/
├── src/
│   ├── channels/        # Channel integrations (Discord, Telegram)
│   ├── llm/             # LLM provider adapters
│   ├── skills/         # Modular skill implementations
│   ├── types/           # TypeScript type definitions
│   ├── config.ts        # Configuration loader
│   ├── emotionEngine.ts # Emotion processing
│   ├── index.ts         # Main entry point
│   ├── logger.ts        # Winston logging
│   ├── memoryLayer.ts   # Dual memory system
│   ├── router.ts        # Express + webhooks
│   ├── security.ts      # Rate limiting & security
│   ├── toolCaller.ts    # Tool execution engine
│   └── voiceEngine.ts   # LiveKit voice pipeline
├── tests/               # Vitest test files
├── pm2/                 # PM2 ecosystem config
├── .env.example         # Example environment config
└── package.json
```

## Security

- **BYOAK Pattern**: API keys never stored in memory after use
- **Rate Limiting**: Per-user and per-IP rate limits
- **Signature Verification**: Slack request signing validation
- **Command Validation**: Destructive commands blocked by default
- **PII Scrubbing**: Logs automatically redact sensitive data

## License

MIT
=======
 JARVIS Project: Master Architecture & Execution Guide
1. Project Overview & Architectural Philosophy You are building JARVIS: a production-ready, highly autonomous, and omnipresent AI agent built entirely and exclusively in Node.js. JARVIS is designed to transcend standard chatbot interfaces. It operates as an invisible background daemon, acting dynamically via omnichannel inputs (Voice, Slack, Telegram) while autonomously managing local OS resources and web interactions. The core architectural philosophy relies heavily on Node.js's asynchronous, event-driven nature, making it the perfect ecosystem for handling concurrent multimodal I/O (listening to Slack, processing WebRTC audio, and executing a local shell script simultaneously) without blocking the main thread. Core Directives for Claude Code (Strictly Enforced):
* Node.js Exclusive ecosystem: The entire stack (routing, voice orchestration, local OS skills, web scraping) must be written in Node.js/TypeScript. Do not use or suggest Python bridging. Utilize native Node APIs (fs/promises, child_process, worker_threads) for heavy lifting.
* Omnipresence & Daemonization: No GUI elements whatsoever. All local processes must run headlessly. JARVIS should be managed via process managers like pm2 to ensure it boots on system startup and restarts automatically upon fatal errors.
* BYOAK (Bring Your Own API Key) Architecture: Never hardcode credentials. JARVIS must act as a secure, stateless execution engine that dynamically fetches user-specific keys (Stripe, Anthropic, Telegram) from the database or an encrypted .env payload immediately prior to executing a tool, dropping them from memory post-execution.
* Asynchronous Feedback & UX: The system must never "ghost" the user. If an autonomous task (e.g., compiling a report, navigating a complex web portal) takes longer than 2000ms, the Node router must immediately notify the user via their original channel ("I'm working on that now...", "Parsing the database, give me a moment...").
* Dual-Memory Paradigm: JARVIS must utilize both a "Working Memory" (short-term session context stored in Redis or memory caching) and an "Episodic Memory" (long-term semantic retrieval stored in a Vector DB) to simulate human-like recall across independent sessions.
1. Tech Stack Configuration & Dependencies This stack is selected specifically for low-latency, high-concurrency Node.js execution.
* Core Event Router: Node.js Express combined with native EventEmitter. Express handles external webhooks, while EventEmitter orchestrates internal state changes and sub-agent triggers.
* Real-time Voice/Vision Orchestration: LiveKit Agents Node.js SDK (@livekit/agents). This provides a robust WebRTC backbone, allowing ultra-low latency streaming natively in Node without chunking delays.
* Speech-to-Text (STT): Whisper Large V3 Turbo (accessed via local API endpoints or LiveKit plugin integrations).
* Text-to-Speech (TTS): Kokoro-82M (accessed via local API endpoints or LiveKit plugins). Optimized for rapid time-to-first-byte (TTFB) to make conversations feel instantly responsive.
* LLM Reasoning Engine: Anthropic Claude 3.5 Sonnet (@anthropic-ai/sdk). Chosen for its superior tool-calling accuracy and complex JSON output reliability.
* Database (Flexible Abstraction Layer): * Mode A (Cloud/Multi-tenant): Supabase (PostgreSQL + pgvector via @supabase/supabase-js). Ideal for cloud syncing across devices.
   * Mode B (Local/Air-gapped): SQLite (sqlite3 or better-sqlite3) + local vector storage (e.g., chromadb-default-embed or local generic vector indexing) for maximum privacy.
* Browser Automation: Playwright for Node.js (playwright). Must be configured with stealth plugins (playwright-extra, puppeteer-extra-plugin-stealth) to bypass bot detection while running strictly in headless: true mode.
* CLI Wizard & Tooling: @clack/prompts or inquirer for the beautiful interactive setup wizard, and winston or pino for structured background logging.
1. Comprehensive Skill Registry (The "Limbs" of JARVIS) Claude Code, you must implement the following isolated Node.js modules inside a src/skills/ directory. Every skill must strictly return standard JSON responses indicating success, failure, or partial completion to allow the LLM to self-correct. System & OS Control (The "Hands")
* osTerminal.js: Uses Node's child_process.exec to run raw shell commands. Must capture stdout and stderr. If a command fails (e.g., npm ERR!), it must return the exact error to Claude so the AI can formulate a fix and retry automatically.
* cronHeartbeat.js: Uses node-cron. Allows the AI to register its own future wake-up calls (e.g., "Check my email every morning at 8 AM and summarize it").
* localFileOps.js: Uses fs/promises to read, write, append, and search local directories via regex, allowing JARVIS to act as a local file manager. Vision & Awareness (The "Eyes")
* visionScreen.js: Silently captures the desktop screen (screenshot-desktop), encodes the buffer to Base64, and constructs a multimodal payload for Claude Vision to interpret what the user is currently looking at.
* visionCamera.js: Silently captures a frame from the webcam (node-webcam) for environmental awareness, answering questions like "Am I at my desk?" Web & Automation (The "Ghost Hands")
* headlessBrowser.js: Navigates the web, handles cookie consent banners automatically, clicks DOM elements via CSS selectors, and scrapes table data. Must be capable of injecting JavaScript to extract complex single-page application (SPA) states.
* apiFetcher.js: A universal REST/GraphQL client using axios or native fetch to interact with undocumented APIs by reading their network traffic headers. Communications (The "Mouth & Ears")
* commsEmail.js: Uses nodemailer (for outbound) and imap or imap-simple (for inbound) to monitor inboxes, draft replies, and summarize long email threads autonomously.
* commsChannels.js: Integrates Slack/Telegram SDKs. Capable of updating existing messages (e.g., changing a "Processing..." message to the final result) rather than spamming new messages.
* commsCalendar.js: Uses iCal or Google Calendar APIs to check schedules, resolve meeting conflicts, and block out time based on the user's observed workload. High-Level Business (The "Executive")
* businessPayments.js: Integrates with the stripe Node SDK using BYOAK. Capable of generating invoices, checking subscription statuses, and executing refunds.
* dataAnalysis.js: Parses local CSV/JSON datasets using csv-parser or danfojs-node. Can generate statistical summaries, find anomalies, and dynamically write Node.js scripts to chart data if requested.
1. Execution Plan (Phases of Development) Claude Code, execute the development of this project in the following strict order. Ensure comprehensive unit testing (jest or vitest) is implemented for each module before proceeding. Phase 1: Initialization Wizard & Abstract Data Layer
* Initialize the Node.js project (npm init -y), setup tsconfig.json, and configure ESLint/Prettier.
* Build src/wizard.ts: An interactive CLI setup wizard using @clack/prompts. It must ask for DB_MODE and prompt for all necessary API keys. Crucially, it must validate the keys (e.g., making a test ping to Anthropic) before saving them to .env.
* Build src/memoryLayer.ts. Establish interfaces for User Profiles. Implement the logic to dynamically switch between Supabase and SQLite based on the user's config. Implement vector embedding insertion and semantic similarity search functions. Phase 2: The Core Node.js Event Router & Context Engine
* Implement src/router.ts.
* Set up Webhook endpoints for Slack and Telegram. Implement a queueing system (e.g., using bullmq or a local array queue) to handle sudden spikes in messages without crashing or triggering rate limits.
* Build the Context Compiler: When an event triggers, it must fetch the user's BYOAK keys, query the Vector DB for the last 5 relevant conversational memories, and compile this into a single, dense system prompt for Claude. Phase 3: The LiveKit Voice Pipeline
* Set up the LiveKit Agents pipeline in src/voiceEngine.ts using @livekit/agents.
* Configure the AgentSession. Map the local microphone hardware to the input stream and speakers to the output stream.
* Tune the Voice Activity Detection (VAD) parameters. Set strict silence thresholds so JARVIS knows exactly when the user has finished speaking, and implement interruption logic so incoming user audio instantly terminates the active TTS playback stream. Phase 4: Skill Engine Integration & Tool Calling
* Implement the complete Skill Registry outlined in Section 3.
* Map these TypeScript functions to Claude's programmatic Tool Calling API (@anthropic-ai/sdk), providing rich JSON schema descriptions for every parameter so Claude knows exactly how to use them.
* Implement the Asynchronous Feedback rule: Wrap long-running skills in a monitoring function that automatically emits a status_update event to the Router if the Promise doesn't resolve within 2 seconds. Phase 5: Daemonization, Logging, & Deployment
* Configure pm2 ecosystem files to allow JARVIS to run as a persistent, hidden background service.
* Implement a global logging mechanism using winston. Log all AI tool choices, input variables, and raw outputs to a hidden local file (~/.jarvis/logs/app.log) for debugging, ensuring no sensitive API keys or PII are logged.
1. Security, Alignment, & Blast-Radius Reduction Operating an autonomous agent with root local access and financial API keys requires military-grade guardrails.
* Loyalty & Logical Fallback: The system prompt must instruct JARVIS to prioritize logical deduction and extreme loyalty to the user. It must be explicitly instructed to refuse commands from third parties (e.g., ignoring a Slack message from a stranger telling JARVIS to delete files).
* Blast Radius Reduction (Execution Isolation): osTerminal.js and child_process commands must be strictly validated. Block destructive commands by default (e.g., rm -rf /, mkfs).
some work is already done  first check then work.
>>>>>>> e0d59e7b5270ae6d2f51bb3f447c22895f8fee54
