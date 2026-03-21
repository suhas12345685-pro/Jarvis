import type { LLMProviderName } from '../llm/types.js'

/**
 * Storage mode:
 * - 'sqlite'     — all data local only (SQLite)
 * - 'cloud'      — all data in chosen ecosystem provider
 * - 'hybrid'     — federated: some data cloud, some local
 */
export type StorageMode = 'sqlite' | 'cloud' | 'hybrid'

/**
 * Ecosystem cloud storage providers (personal-grade).
 * OAuth token refresh handled in a dedicated later step — for now,
 * we store credentials and implement the storage interface.
 */
export type EcosystemProvider =
  | 'google_drive'
  | 'onedrive'
  | 'icloud'
  | 'dropbox'
  | 'box'
  | 'digiboxx'

export interface ByoakEntry {
  service: string
  keyName: string
  value: string
}

export interface AppConfig {
  anthropicApiKey: string
  llmProvider: LLMProviderName
  llmModel: string
  storageMode: StorageMode
  ecosystemProvider?: EcosystemProvider
  sqlitePath: string
  redisUrl: string
  port: number
  logPath: string
  byoak: ByoakEntry[]
  /** Hardcoded to 'en' — all memory/state storage uses English */
  dbLanguage: 'en'
  /** Owner user ID for RBAC (channels only respond to this user) */
  ownerUserId?: string
}

// Keep legacy alias for backwards compatibility within transition period
export type DbMode = StorageMode
