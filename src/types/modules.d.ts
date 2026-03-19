// Type declarations for modules without @types packages

declare module 'node-webcam' {
  interface WebcamOptions {
    width?: number
    height?: number
    quality?: number
    output?: string
    device?: boolean | string
    callbackReturn?: string
    verbose?: boolean
  }

  interface Webcam {
    capture(path: string, callback: (err: Error | null, data?: string) => void): void
  }

  const NodeWebcam: {
    create(options: WebcamOptions): Webcam
  }

  export default NodeWebcam
}

declare module 'screenshot-desktop' {
  function screenshot(options?: { format?: string }): Promise<Buffer>
  export default screenshot
}

declare module '@livekit/agents' {
  export class AgentSession {
    constructor(opts: { stt?: stt.STT; tts?: tts.TTS; vad?: vad.VAD; llm?: llm.LLM })
    on(event: string, handler: (...args: unknown[]) => void): void
    say(text: string, opts?: Record<string, unknown>): Promise<void>
    start(room: Room, participant: RemoteParticipant): Promise<void>
  }

  export class WorkerOptions {
    constructor(opts: { agent: unknown; wsURL: string; apiKey: string; apiSecret: string })
  }

  export interface JobContext {
    room: Room
    connect(): Promise<void>
    waitForParticipant(): Promise<RemoteParticipant>
  }

  export interface Room {
    name: string
  }

  export interface RemoteParticipant {
    identity: string
  }

  export function defineAgent(opts: { entry: (ctx: JobContext) => Promise<void> }): unknown
  export const cli: { runApp(opts: WorkerOptions): void }

  export namespace stt {
    export class StreamAdapter {
      constructor(stt: STT)
    }
    export interface STT {
      stream: () => unknown
    }
  }

  export namespace tts {
    export interface TTS {
      synthesize: (text: string) => Promise<unknown>
    }
  }

  export namespace vad {
    export class SileroVAD {
      constructor(opts: { minSilenceDuration: number; speechPadDuration: number })
    }
    export interface VAD {}
  }

  export namespace llm {
    export interface LLM {
      chat: (opts: { messages: { role: string; content: string }[] }) => Promise<unknown>
    }
  }
}

declare module '@livekit/agents-plugin-deepgram' {
  export class STT {
    constructor()
  }
}

declare module '@livekit/agents-plugin-elevenlabs' {
  export class TTS {
    constructor()
  }
}

declare module '@livekit/agents-plugin-google' {
  export class STT {
    constructor()
  }
  export class TTS {
    constructor()
  }
}
