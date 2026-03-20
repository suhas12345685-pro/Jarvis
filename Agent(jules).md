# JARVIS Development Directives for Jules

## Core Architecture
- **Language:** Strictly Node.js/TypeScript. No Python bridging. Use native APIs (`fs/promises`, `child_process`).
- **Paradigm:** Asynchronous, event-driven, and headless.
- **Security (BYOAK):** Never hardcode API keys. Keys must be fetched dynamically at runtime and dropped from memory post-execution. 

## Skill Development Rules
- All skills in `src/skills/` must return standardized JSON responses indicating success, failure, or partial completion.
- **Async Feedback Rule:** Any skill taking longer than 2000ms must emit a `status_update` event to the Router to prevent "ghosting" the user.
- **Blast Radius:** Modules like `osTerminal.ts` must aggressively validate inputs and block destructive commands (e.g., `rm -rf /`) by default.
