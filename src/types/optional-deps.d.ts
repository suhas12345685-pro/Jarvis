// Type declarations for optional dependencies that may not be installed.
// These provide basic type stubs so TypeScript compiles without errors.
// Install the actual packages for full functionality.

declare module '@aws-sdk/client-s3' {
  export class S3Client {
    constructor(config: any)
    send(command: any): Promise<any>
  }
  export class ListObjectsV2Command { constructor(input: any) }
  export class PutObjectCommand { constructor(input: any) }
  export class GetObjectCommand { constructor(input: any) }
  export class DeleteObjectCommand { constructor(input: any) }
}

declare module 'pg' {
  class Client {
    constructor(config: any)
    connect(): Promise<void>
    query(text: string, values?: any[]): Promise<{ rows: any[]; rowCount: number | null }>
    end(): Promise<void>
  }
  export default { Client }
}

declare module 'mysql2/promise' {
  export function createConnection(uri: string): Promise<{
    execute(sql: string, values?: any[]): Promise<[any, any]>
    end(): Promise<void>
  }>
}

declare module 'sharp' {
  interface SharpInstance {
    resize(options: any): SharpInstance
    jpeg(options?: any): SharpInstance
    png(options?: any): SharpInstance
    webp(options?: any): SharpInstance
    avif(options?: any): SharpInstance
    tiff(options?: any): SharpInstance
    toFile(path: string): Promise<any>
    metadata(): Promise<{
      format?: string; width?: number; height?: number
      channels?: number; space?: string; depth?: string
      density?: number; hasAlpha?: boolean; orientation?: number
    }>
  }
  function sharp(input: string | Buffer): SharpInstance
  export default sharp
}

declare module 'qrcode' {
  export function toFile(path: string, data: string, options?: any): Promise<void>
}

declare module 'pdf-parse' {
  function pdfParse(buffer: Buffer): Promise<{
    text: string; numpages: number; info: Record<string, any>
  }>
  export default pdfParse
}

declare module 'vosk' {
  export function setLogLevel(level: number): void
  export class Model {
    constructor(path: string)
    free(): void
  }
  export class Recognizer {
    constructor(opts: { model: Model; sampleRate: number })
    acceptWaveform(buffer: Buffer): boolean
    result(): { text?: string }
    free(): void
  }
}

declare module '@ricky0123/vad-node' {
  export class MicVAD {
    static new(opts: {
      onSpeechStart?: () => void
      onSpeechEnd?: (audio: Float32Array) => void
      positiveSpeechThreshold?: number
      negativeSpeechThreshold?: number
      minSpeechFrames?: number
    }): Promise<MicVAD>
    start(): Promise<void>
    destroy(): void
  }
}

declare module 'piper-tts-node' {
  export function synthesize(text: string, opts?: any): Promise<Buffer>
}
