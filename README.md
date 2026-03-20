# JARVIS - Autonomous AI Agent

A production-ready, highly autonomous, and omnipresent AI agent built entirely and exclusively in Node.js/TypeScript. JARVIS is designed to transcend standard chatbot interfaces, operating as an invisible background daemon. It acts dynamically via omnichannel inputs (Voice, Slack, Telegram) while autonomously managing local OS resources, web interactions, and maintaining an asynchronous, event-driven architecture.

## Core Directives & Philosophy
- **Node.js Exclusive**: The entire stack (routing, voice orchestration, local OS skills, web scraping) is written in Node.js/TypeScript using native APIs.
- **Omnipresence & Daemonization**: Runs headlessly without GUI elements, managed via process managers like PM2 to ensure it boots on startup and recovers from errors.
- **BYOAK (Bring Your Own API Key)**: Secure, stateless execution where keys are fetched dynamically and dropped from memory post-execution. Never hardcoded.
- **Asynchronous Feedback**: The system never "ghosts" the user. If a task takes longer than 2000ms, it provides immediate status updates.
- **Dual-Memory Paradigm**: Utilizes Working Memory (Redis/caching) for short-term context and Episodic Memory (Vector DB) for long-term semantic retrieval.

## Features & Core Capabilities
- **Omni-Channel Communication**: Telegram, Discord, Slack, Google Chat, Voice (LiveKit)
- **Vision & Awareness**: Screen capture, webcam analysis
- **File Operations**: Read, write, search local filesystem
- **Terminal Control**: Execute shell commands with safety validation
- **Web Automation**: Headless browser with stealth mode
- **Emotion System**: Contextual emotional responses with sentiment analysis

## Tech Stack
- **Core Event Router**: Node.js Express + native EventEmitter
- **Real-time Voice/Vision**: LiveKit Agents Node.js SDK (@livekit/agents)
- **STT/TTS**: Whisper Large V3 Turbo & Kokoro-82M
- **LLM Engine**: Anthropic Claude 3.5 Sonnet (@anthropic-ai/sdk)
- **Database**: Flexible layer (Supabase + pgvector for cloud; SQLite + local vector storage for air-gapped)
- **Browser Automation**: Playwright (with stealth plugins `playwright-extra`)

## Quick Start

### Prerequisites
- Node.js 20+
- Redis (for queue & working memory)
- API keys for LLM providers

### Installation

```bash
git clone [https://github.com/suhas12345685-pro/Jarvis.git](https://github.com/suhas12345685-pro/Jarvis.git)
cd Jarvis
npm install