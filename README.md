# JARVIS — Autonomous AI Agent

An autonomous, multi-modal AI agent built in Node.js/TypeScript that can talk, see, code, pay, browse, join meetings, answer calls, build its own tools, and act proactively — all before you ask.

## Highlights

- **89 built-in skills** across 28 skill modules
- **9 LLM providers** — Anthropic, OpenAI, Gemini, xAI, DeepSeek, Moonshot, Ollama, Meta, Perplexity
- **7 embedding providers** — OpenAI, Voyage, Gemini, Cohere, DeepSeek, Ollama, local fallback
- **Multi-channel** — Slack, Discord, Telegram, Google Chat, REST API, Voice (LiveKit)
- **Proactive engine** — cron/interval scheduler that acts before you ask
- **Meeting & call engine** — join meetings (LiveKit/WebRTC), answer/make calls (Twilio)
- **Self-tool-builder** — JARVIS creates, updates, and persists its own skills at runtime
- **Streaming tool loop** — real-time `AsyncIterable` output to channels
- **Semantic memory** — multi-provider embeddings with SQLite or Supabase/pgvector
- **Security hardened** — SSRF protection, rate limiting, input sanitization, sandboxed skill execution
- **100 tests** — 88 unit + 12 integration

## Quick Start

```bash
# Install dependencies
npm install

# Run interactive setup wizard
npm run setup

# Start in development mode
npm run dev

# Or build and run production
npm run build && npm start
```

## Configuration

Copy `.env.example` to `.env` and fill in the keys you need. The setup wizard (`npm run setup`) walks you through the essentials.

### Required

| Variable | Description |
|----------|-------------|
| `LLM_PROVIDER` | LLM backend: `anthropic`, `openai`, `gemini`, `xai`, `deepseek`, `moonshot`, `ollama`, `meta`, `perplexity` |
| `LLM_API_KEY` | API key for your chosen LLM provider |
| `LLM_MODEL` | Model ID (e.g. `claude-sonnet-4-20250514`, `gpt-4o`, `gemini-pro`) |

### Optional (by feature)

| Feature | Variables |
|---------|-----------|
| Slack | `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_APP_TOKEN` |
| Discord | `DISCORD_BOT_TOKEN` |
| Telegram | `TELEGRAM_BOT_TOKEN` |
| Google Chat | `GOOGLE_CHAT_SERVICE_ACCOUNT` |
| Email | `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_IMAP_*` |
| Voice | `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` |
| Meetings | `LIVEKIT_*` (same as voice) |
| Calls | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` |
| Payments | `STRIPE_SECRET_KEY`, `RAZORPAY_KEY_*`, `PAYPAL_CLIENT_*` |
| Calendar | `GOOGLE_CALENDAR_*` |
| Web Search | `SERPAPI_KEY` or `GOOGLE_SEARCH_*` |
| Memory (Supabase) | `SUPABASE_URL`, `SUPABASE_KEY` |
| Embeddings | Auto-detected from `LLM_PROVIDER`, or override with `EMBEDDING_PROVIDER` |
| Proactive Engine | `PROACTIVE_ENGINE_ENABLED=true` |

## Architecture

```
src/
├── index.ts              # Entry point — boots channels, voice, proactive engine
├── config.ts             # Environment config loader
├── router.ts             # Express API + webhook endpoints (rate-limited)
├── toolCaller.ts         # LLM tool loop — standard & streaming with retries
├── memoryLayer.ts        # Semantic memory — multi-provider embeddings
├── voiceEngine.ts        # LiveKit voice with auto-reconnect
├── proactiveEngine.ts    # Cron/interval scheduler for autonomous tasks
├── meetingEngine.ts      # Meeting join + call answer/make via LiveKit & Twilio
├── security.ts           # SSRF protection, rate limiting, input sanitization
├── logger.ts             # Winston structured logging
├── wizard.ts             # Interactive setup CLI
└── skills/               # 28 skill modules (89 skills)
    ├── index.ts           # Skill registry — loads all modules + custom skills
    ├── skillBuilder.ts    # Runtime skill creation (sandboxed)
    ├── proactive.ts       # Proactive task management
    ├── meetingCall.ts     # Meeting & call skills
    ├── apiFetcher.ts      # HTTP requests (SSRF-protected)
    ├── webSearch.ts       # Web search & scraping
    ├── headlessBrowser.ts # Puppeteer browser automation
    ├── localFileOps.ts    # File system operations
    ├── commsChannels.ts   # Slack messaging
    ├── commsDiscord.ts    # Discord messaging
    ├── commsEmail.ts      # Email send/read (SMTP/IMAP)
    ├── commsGChat.ts      # Google Chat
    ├── commsCalendar.ts   # Google Calendar
    ├── cronHeartbeat.ts   # Cron scheduling
    ├── dataAnalysis.ts    # CSV/JSON analysis
    ├── textTransform.ts   # Summarize, regex, JSON transform
    ├── visionCamera.ts    # Camera capture + LLM vision
    ├── visionScreen.ts    # Screenshot + LLM vision
    ├── osTerminal.ts      # Safe shell execution
    ├── businessPayments.ts      # Stripe payments
    ├── businessPaymentsPaypal.ts # PayPal payments
    ├── businessPaymentsRazorpay.ts # Razorpay payments
    ├── mathCrypto.ts      # Math eval, unit conversion, crypto ops
    ├── systemInfo.ts      # System info, processes, env, date/time
    ├── encoding.ts        # Base64, URL, JWT, HTML, JSON encoding
    ├── gitOps.ts          # Git status, log, diff, clone
    ├── notifications.ts   # Slack/webhook/email notifications
    └── memorySkills.ts    # Memory store, recall, context

src/llm/                  # LLM provider abstraction
├── types.ts              # LLMProvider interface + streaming types
├── registry.ts           # Provider factory + registry
├── anthropic.ts          # Anthropic Claude (streaming)
├── openai-compat.ts      # OpenAI-compatible (streaming)
└── gemini.ts             # Google Gemini (streaming)

src/channels/             # Input channels
├── slack.ts              # Slack Bolt app
├── discord.ts            # Discord.js bot
├── telegram.ts           # Telegram polling bot
└── googleChat.ts         # Google Chat webhook

tests/
├── unit/                 # 88 unit tests
│   ├── skills/           # Skill-specific tests
│   ├── llm/              # LLM registry tests
│   ├── embedding.test.ts # Embedding provider tests
│   ├── security.test.ts  # Security utility tests
│   └── logger.test.ts    # Logger tests
└── integration/          # 12 integration tests
    └── router.test.ts    # API + webhook endpoint tests
```

## All 89 Skills

| Category | Skills |
|----------|--------|
| **Web & API** | `api_fetch`, `web_search`, `web_scrape_text`, `graphql_query` |
| **Browser** | `browser_navigate`, `browser_click`, `browser_extract` |
| **Files** | `file_read`, `file_write`, `file_append`, `file_list`, `file_search` |
| **Messaging** | `slack_send`, `slack_update_message`, `discord_send`, `discord_reply`, `telegram_send`, `gchat_send`, `gchat_list_spaces` |
| **Email** | `email_send`, `email_read` |
| **Calendar** | `calendar_list_events`, `calendar_create_event`, `calendar_delete_event` |
| **Meetings & Calls** | `meeting_join`, `meeting_speak`, `meeting_end`, `meeting_list_active`, `meeting_get_transcript`, `meeting_get_notes`, `call_answer`, `call_make` |
| **Payments** | `stripe_create_payment_intent`, `stripe_create_customer`, `stripe_create_invoice`, `stripe_list_charges`, `razorpay_create_order`, `razorpay_fetch_payments`, `razorpay_create_invoice`, `razorpay_issue_refund`, `paypal_create_order`, `paypal_capture_order`, `paypal_create_payout`, `paypal_issue_refund` |
| **Data** | `data_analyze_csv`, `data_analyze_json` |
| **Text** | `text_summarize`, `text_regex`, `json_transform` |
| **Vision** | `vision_camera`, `vision_screen` |
| **System** | `os_terminal`, `system_info`, `system_processes`, `system_env_get`, `system_date_time`, `system_sleep` |
| **Cron** | `cron_register`, `cron_unregister`, `cron_list` |
| **Math & Crypto** | `math_evaluate`, `math_unit_convert`, `crypto_hash`, `crypto_random`, `crypto_encrypt`, `crypto_decrypt` |
| **Encoding** | `encode_base64`, `encode_url`, `encode_jwt_decode`, `encode_html`, `encode_json_format` |
| **Git** | `git_status`, `git_log`, `git_diff`, `git_clone` |
| **Notifications** | `notify_slack`, `notify_webhook`, `notify_email_quick` |
| **Memory** | `memory_store`, `memory_recall`, `memory_context` |
| **Proactive** | `proactive_create_task`, `proactive_list_tasks`, `proactive_toggle_task`, `proactive_delete_task` |
| **Self-Build** | `skill_create`, `skill_update`, `skill_delete`, `skill_list` |

## Key Features

### Proactive Engine

JARVIS can act autonomously on schedules — morning briefings, system health checks, meeting prep, email digests. Create custom proactive tasks via the `proactive_create_task` skill with cron expressions or interval timers.

### Meeting & Call Engine

- **Join meetings** via LiveKit/WebRTC with automatic note-taking
- **Answer inbound calls** via Twilio with contextual responses
- **Make outbound calls** with text-to-speech
- Auto-generates summaries and extracts action items when sessions end

### Self-Tool-Builder

JARVIS can create new skills at runtime using `skill_create`. Code is sandboxed (blocked: `process.exit`, `child_process`, `eval`, `require`, `import`) and persisted to `~/.jarvis/custom-skills/` for reload on restart.

### Streaming Tool Loop

The `runStreamingToolLoop()` function uses LLM `stream()` methods to deliver real-time text deltas to channels as the agent thinks and responds, rather than waiting for the full response.

### Multi-Provider Embeddings

Embedding provider is auto-detected from `LLM_PROVIDER` config. Supported: OpenAI (`text-embedding-3-small`), Voyage (`voyage-3`), Gemini (`text-embedding-004`), Cohere (`embed-english-v3.0`), DeepSeek, Ollama (`nomic-embed-text`), and a local deterministic fallback.

### Security

- **SSRF protection** — blocks private IPs, cloud metadata endpoints, non-HTTP schemes
- **Rate limiting** — per-IP sliding window (100 req/min default)
- **Header validation** — CRLF injection detection
- **Input sanitization** — length-based truncation
- **Webhook verification** — Slack HMAC, Telegram secret token

## Scripts

```bash
npm run dev              # Development with hot-reload
npm run build            # Compile TypeScript
npm start                # Run compiled output
npm run setup            # Interactive setup wizard
npm test                 # Run unit tests (88)
npm run test:integration # Run integration tests (12)
npm run test:coverage    # Tests with coverage report
npm run typecheck        # TypeScript type check
npm run lint             # ESLint
npm run format           # Prettier
npm run pm2:start        # Start with PM2
npm run pm2:stop         # Stop PM2 process
```

## Deployment

JARVIS includes a PM2 ecosystem config for production:

```bash
npm run build
npm run pm2:start
```

Set `PORT` (default 3000) and `NODE_ENV=production` in your environment.

## License

MIT
