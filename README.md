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
