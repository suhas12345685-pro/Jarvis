export type DbMode = 'supabase' | 'sqlite'

export interface ByoakEntry {
  service: string
  keyName: string
  value: string
}

export interface AppConfig {
  anthropicApiKey: string
  dbMode: DbMode
  supabaseUrl?: string
  supabaseServiceKey?: string
  sqlitePath: string
  redisUrl: string
  port: number
  logPath: string
  byoak: ByoakEntry[]
}
