/**
 * Federated Memory Manager
 *
 * Wraps the existing MemoryLayer with cognitive classification and routes
 * memory storage based on the configured StorageMode:
 *
 * - sqlite:  All data local only
 * - cloud:   All data to the chosen Ecosystem Provider (Google Drive, OneDrive, etc.)
 * - hybrid:  Federated — routes high-importance / large blobs to cloud,
 *            keeps transient/fast-access data in local SQLite
 *
 * Ecosystem providers store data as JSON files in a `.jarvis/` folder on
 * the remote drive. OAuth token refresh is handled in a dedicated later step —
 * the interfaces are implemented now.
 *
 * Database language is hardcoded to English.
 */

import type { MemoryLayer } from '../memoryLayer.js'
import type { LLMProvider } from '../llm/types.js'
import type { Memory } from '../types/agent.js'
import type { StorageMode, EcosystemProvider, AppConfig } from '../types/index.js'
import { getLogger } from '../logger.js'
import { getByoakValue } from '../config.js'
import {
  classifyHeuristic,
  classifyWithLLM,
  type ClassifiedMemory,
  type MemoryType,
} from './memoryClassifier.js'

const logger = getLogger()

/** Hardcoded database language — all stored content is in English */
const DB_LANGUAGE = 'en'

// ── Ecosystem Storage Interface ──────────────────────────────────────────────

export interface EcosystemStorageAdapter {
  readonly name: string
  /** Upload a JSON document to the remote store */
  put(key: string, data: Record<string, unknown>): Promise<void>
  /** Retrieve a JSON document by key */
  get(key: string): Promise<Record<string, unknown> | null>
  /** Delete a document by key */
  delete(key: string): Promise<void>
  /** List all document keys matching a prefix */
  list(prefix: string): Promise<string[]>
}

// ── Ecosystem Storage Implementations ─────────────────────────────────────────

class GoogleDriveStorage implements EcosystemStorageAdapter {
  readonly name = 'google_drive'
  private accessToken: string
  private folderId: string | null = null

  constructor(private config: AppConfig) {
    this.accessToken = getByoakValue(config.byoak, 'gdrive', 'REFRESH_TOKEN') ?? ''
  }

  private async ensureFolder(): Promise<string> {
    if (this.folderId) return this.folderId
    const axios = (await import('axios')).default
    // Search for existing .jarvis folder
    const searchRes = await axios.get('https://www.googleapis.com/drive/v3/files', {
      headers: { Authorization: `Bearer ${this.accessToken}` },
      params: {
        q: "name='.jarvis' and mimeType='application/vnd.google-apps.folder' and trashed=false",
        fields: 'files(id)',
      },
    })
    if (searchRes.data.files?.length > 0) {
      this.folderId = searchRes.data.files[0].id
      return this.folderId!
    }
    // Create .jarvis folder
    const createRes = await axios.post(
      'https://www.googleapis.com/drive/v3/files',
      { name: '.jarvis', mimeType: 'application/vnd.google-apps.folder' },
      { headers: { Authorization: `Bearer ${this.accessToken}`, 'Content-Type': 'application/json' } },
    )
    this.folderId = createRes.data.id
    return this.folderId!
  }

  async put(key: string, data: Record<string, unknown>): Promise<void> {
    const axios = (await import('axios')).default
    const folderId = await this.ensureFolder()
    const content = JSON.stringify({ ...data, _lang: DB_LANGUAGE })
    // Check if file exists
    const existing = await this.findFile(key)
    if (existing) {
      await axios.patch(
        `https://www.googleapis.com/upload/drive/v3/files/${existing}?uploadType=media`,
        content,
        { headers: { Authorization: `Bearer ${this.accessToken}`, 'Content-Type': 'application/json' } },
      )
    } else {
      const metadata = { name: `${key}.json`, parents: [folderId] }
      const boundary = 'jarvis_boundary'
      const body = `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${content}\r\n--${boundary}--`
      await axios.post(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
        body,
        { headers: { Authorization: `Bearer ${this.accessToken}`, 'Content-Type': `multipart/related; boundary=${boundary}` } },
      )
    }
  }

  async get(key: string): Promise<Record<string, unknown> | null> {
    const axios = (await import('axios')).default
    const fileId = await this.findFile(key)
    if (!fileId) return null
    const res = await axios.get(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    })
    return res.data as Record<string, unknown>
  }

  async delete(key: string): Promise<void> {
    const axios = (await import('axios')).default
    const fileId = await this.findFile(key)
    if (fileId) {
      await axios.delete(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      })
    }
  }

  async list(prefix: string): Promise<string[]> {
    const axios = (await import('axios')).default
    const folderId = await this.ensureFolder()
    const res = await axios.get('https://www.googleapis.com/drive/v3/files', {
      headers: { Authorization: `Bearer ${this.accessToken}` },
      params: {
        q: `'${folderId}' in parents and name contains '${prefix}' and trashed=false`,
        fields: 'files(name)',
      },
    })
    return (res.data.files ?? []).map((f: { name: string }) => f.name.replace('.json', ''))
  }

  private async findFile(key: string): Promise<string | null> {
    const axios = (await import('axios')).default
    const folderId = await this.ensureFolder()
    const res = await axios.get('https://www.googleapis.com/drive/v3/files', {
      headers: { Authorization: `Bearer ${this.accessToken}` },
      params: {
        q: `'${folderId}' in parents and name='${key}.json' and trashed=false`,
        fields: 'files(id)',
      },
    })
    return res.data.files?.[0]?.id ?? null
  }
}

class OneDriveStorage implements EcosystemStorageAdapter {
  readonly name = 'onedrive'
  private accessToken: string

  constructor(private config: AppConfig) {
    this.accessToken = getByoakValue(config.byoak, 'onedrive', 'REFRESH_TOKEN') ?? ''
  }

  private get baseUrl() { return 'https://graph.microsoft.com/v1.0/me/drive/root:/Apps/.jarvis' }

  async put(key: string, data: Record<string, unknown>): Promise<void> {
    const axios = (await import('axios')).default
    const content = JSON.stringify({ ...data, _lang: DB_LANGUAGE })
    await axios.put(
      `${this.baseUrl}/${key}.json:/content`,
      content,
      { headers: { Authorization: `Bearer ${this.accessToken}`, 'Content-Type': 'application/json' } },
    )
  }

  async get(key: string): Promise<Record<string, unknown> | null> {
    const axios = (await import('axios')).default
    try {
      const res = await axios.get(`${this.baseUrl}/${key}.json:/content`, {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      })
      return res.data as Record<string, unknown>
    } catch { return null }
  }

  async delete(key: string): Promise<void> {
    const axios = (await import('axios')).default
    try {
      await axios.delete(`${this.baseUrl}/${key}.json`, {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      })
    } catch { /* file may not exist */ }
  }

  async list(prefix: string): Promise<string[]> {
    const axios = (await import('axios')).default
    try {
      const res = await axios.get(`${this.baseUrl}:/children`, {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      })
      return (res.data.value ?? [])
        .map((f: { name: string }) => f.name.replace('.json', ''))
        .filter((n: string) => n.startsWith(prefix))
    } catch { return [] }
  }
}

class DropboxStorage implements EcosystemStorageAdapter {
  readonly name = 'dropbox'
  private accessToken: string

  constructor(private config: AppConfig) {
    this.accessToken = getByoakValue(config.byoak, 'dropbox', 'ACCESS_TOKEN') ?? ''
  }

  async put(key: string, data: Record<string, unknown>): Promise<void> {
    const axios = (await import('axios')).default
    const content = JSON.stringify({ ...data, _lang: DB_LANGUAGE })
    await axios.post('https://content.dropboxapi.com/2/files/upload', content, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/octet-stream',
        'Dropbox-API-Arg': JSON.stringify({ path: `/.jarvis/${key}.json`, mode: 'overwrite' }),
      },
    })
  }

  async get(key: string): Promise<Record<string, unknown> | null> {
    const axios = (await import('axios')).default
    try {
      const res = await axios.post('https://content.dropboxapi.com/2/files/download', null, {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Dropbox-API-Arg': JSON.stringify({ path: `/.jarvis/${key}.json` }),
        },
      })
      return res.data as Record<string, unknown>
    } catch { return null }
  }

  async delete(key: string): Promise<void> {
    const axios = (await import('axios')).default
    try {
      await axios.post('https://api.dropboxapi.com/2/files/delete_v2', {
        path: `/.jarvis/${key}.json`,
      }, { headers: { Authorization: `Bearer ${this.accessToken}`, 'Content-Type': 'application/json' } })
    } catch { /* file may not exist */ }
  }

  async list(prefix: string): Promise<string[]> {
    const axios = (await import('axios')).default
    try {
      const res = await axios.post('https://api.dropboxapi.com/2/files/list_folder', {
        path: '/.jarvis',
      }, { headers: { Authorization: `Bearer ${this.accessToken}`, 'Content-Type': 'application/json' } })
      return (res.data.entries ?? [])
        .map((e: { name: string }) => e.name.replace('.json', ''))
        .filter((n: string) => n.startsWith(prefix))
    } catch { return [] }
  }
}

class BoxStorage implements EcosystemStorageAdapter {
  readonly name = 'box'
  private accessToken: string

  constructor(private config: AppConfig) {
    this.accessToken = getByoakValue(config.byoak, 'box', 'ACCESS_TOKEN') ?? ''
  }

  async put(key: string, data: Record<string, unknown>): Promise<void> {
    const axios = (await import('axios')).default
    const content = JSON.stringify({ ...data, _lang: DB_LANGUAGE })
    // Upload to root — simplified; production would resolve folder ID
    const attributes = { name: `${key}.json`, parent: { id: '0' } }
    const FormData = (await import('axios')).default // simplified for interface
    await axios.post('https://upload.box.com/api/2.0/files/content', content, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      params: { attributes: JSON.stringify(attributes) },
    })
  }

  async get(key: string): Promise<Record<string, unknown> | null> {
    // Box requires file ID lookup — simplified interface
    logger.debug('Box get not fully implemented yet', { key })
    return null
  }

  async delete(key: string): Promise<void> {
    logger.debug('Box delete not fully implemented yet', { key })
  }

  async list(prefix: string): Promise<string[]> {
    logger.debug('Box list not fully implemented yet', { prefix })
    return []
  }
}

class ICloudStorage implements EcosystemStorageAdapter {
  readonly name = 'icloud'

  constructor(private config: AppConfig) {}

  async put(key: string, data: Record<string, unknown>): Promise<void> {
    // iCloud Drive API is private — using CloudKit JS API as proxy
    logger.debug('iCloud put — interface ready, CloudKit integration pending', { key })
  }

  async get(key: string): Promise<Record<string, unknown> | null> {
    logger.debug('iCloud get — interface ready, CloudKit integration pending', { key })
    return null
  }

  async delete(key: string): Promise<void> {
    logger.debug('iCloud delete — interface ready, CloudKit integration pending', { key })
  }

  async list(prefix: string): Promise<string[]> {
    logger.debug('iCloud list — interface ready, CloudKit integration pending', { prefix })
    return []
  }
}

class DigiboxxStorage implements EcosystemStorageAdapter {
  readonly name = 'digiboxx'
  private accessToken: string

  constructor(private config: AppConfig) {
    this.accessToken = getByoakValue(config.byoak, 'digiboxx', 'ACCESS_TOKEN') ?? ''
  }

  async put(key: string, data: Record<string, unknown>): Promise<void> {
    const axios = (await import('axios')).default
    const content = JSON.stringify({ ...data, _lang: DB_LANGUAGE })
    await axios.post('https://api.digiboxx.com/api/v1/files/upload', content, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
        'X-File-Name': `${key}.json`,
        'X-Folder-Path': '/.jarvis/',
      },
    })
  }

  async get(key: string): Promise<Record<string, unknown> | null> {
    const axios = (await import('axios')).default
    try {
      const res = await axios.get(`https://api.digiboxx.com/api/v1/files/download`, {
        headers: { Authorization: `Bearer ${this.accessToken}` },
        params: { path: `/.jarvis/${key}.json` },
      })
      return res.data as Record<string, unknown>
    } catch { return null }
  }

  async delete(key: string): Promise<void> {
    const axios = (await import('axios')).default
    try {
      await axios.delete('https://api.digiboxx.com/api/v1/files', {
        headers: { Authorization: `Bearer ${this.accessToken}` },
        params: { path: `/.jarvis/${key}.json` },
      })
    } catch { /* ignore */ }
  }

  async list(prefix: string): Promise<string[]> {
    const axios = (await import('axios')).default
    try {
      const res = await axios.get('https://api.digiboxx.com/api/v1/files/list', {
        headers: { Authorization: `Bearer ${this.accessToken}` },
        params: { path: '/.jarvis/' },
      })
      return (res.data.files ?? [])
        .map((f: { name: string }) => f.name.replace('.json', ''))
        .filter((n: string) => n.startsWith(prefix))
    } catch { return [] }
  }
}

// ── Factory ─────────────────────────────────────────────────────────────────

export function createEcosystemAdapter(
  provider: EcosystemProvider,
  config: AppConfig,
): EcosystemStorageAdapter {
  switch (provider) {
    case 'google_drive': return new GoogleDriveStorage(config)
    case 'onedrive': return new OneDriveStorage(config)
    case 'icloud': return new ICloudStorage(config)
    case 'dropbox': return new DropboxStorage(config)
    case 'box': return new BoxStorage(config)
    case 'digiboxx': return new DigiboxxStorage(config)
    default: throw new Error(`Unsupported ecosystem provider: ${provider}`)
  }
}

// ── Types ───────────────────────────────────────────────────────────────────

export interface FederatedSearchOptions {
  types?: MemoryType[]      // filter to specific memory types
  topK?: number             // max results (default 10)
  minImportance?: number    // filter by importance threshold (0-1)
  userId?: string           // filter to a specific user
  boostTypes?: Partial<Record<MemoryType, number>>  // weight multipliers
}

export interface FederatedMemoryResult {
  content: string
  type: MemoryType
  importance: number
  tags: string[]
  score: number             // combined relevance score
  metadata: Record<string, unknown>
}

// ── Manager ─────────────────────────────────────────────────────────────────

export class FederatedMemoryManager {
  private memory: MemoryLayer
  private provider: LLMProvider | null
  private model: string
  private storageMode: StorageMode
  private cloudAdapter: EcosystemStorageAdapter | null

  constructor(
    memory: MemoryLayer,
    provider?: LLMProvider,
    model?: string,
    config?: AppConfig,
  ) {
    this.memory = memory
    this.provider = provider ?? null
    this.model = model ?? ''
    this.storageMode = config?.storageMode ?? 'sqlite'
    this.cloudAdapter = null

    if (config && config.ecosystemProvider && (config.storageMode === 'cloud' || config.storageMode === 'hybrid')) {
      try {
        this.cloudAdapter = createEcosystemAdapter(config.ecosystemProvider, config)
        logger.info('Ecosystem storage adapter initialized', {
          provider: config.ecosystemProvider,
          mode: config.storageMode,
        })
      } catch (err) {
        logger.warn('Failed to initialize ecosystem adapter, falling back to SQLite', {
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }

  /**
   * Store a memory with automatic cognitive classification.
   * Routes to the appropriate backend based on storage mode.
   */
  async store(
    content: string,
    userId?: string,
    extraMetadata?: Record<string, unknown>,
  ): Promise<ClassifiedMemory> {
    // Classify the memory
    let classified: ClassifiedMemory
    if (this.provider && this.model) {
      classified = await classifyWithLLM(content, this.provider, this.model)
    } else {
      classified = classifyHeuristic(content)
    }

    const metadata = {
      ...extraMetadata,
      memoryType: classified.type,
      confidence: classified.confidence,
      importance: classified.importance,
      tags: classified.tags,
      userId,
      classifiedAt: new Date().toISOString(),
      _lang: DB_LANGUAGE,
    }

    // Route based on storage mode
    if (this.storageMode === 'cloud' && this.cloudAdapter) {
      // Cloud only — store in ecosystem provider
      const key = `memory_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      await this.cloudAdapter.put(key, { content, ...metadata })
    } else if (this.storageMode === 'hybrid' && this.cloudAdapter) {
      // Hybrid: high-importance goes to cloud, everything goes to SQLite
      await this.memory.insertMemory(content, metadata)
      if (classified.importance >= 0.6) {
        const key = `memory_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        await this.cloudAdapter.put(key, { content, ...metadata }).catch(err => {
          logger.warn('Cloud memory write failed (non-fatal)', {
            error: err instanceof Error ? err.message : String(err),
          })
        })
      }
    } else {
      // SQLite only (default)
      await this.memory.insertMemory(content, metadata)
    }

    logger.debug('Federated memory stored', {
      type: classified.type,
      importance: classified.importance,
      tags: classified.tags,
      route: this.storageMode,
    })

    return classified
  }

  /**
   * Store a pre-classified memory (skip classification step).
   */
  async storeDirect(
    classified: ClassifiedMemory,
    userId?: string,
    extraMetadata?: Record<string, unknown>,
  ): Promise<void> {
    const metadata = {
      ...extraMetadata,
      memoryType: classified.type,
      confidence: classified.confidence,
      importance: classified.importance,
      tags: classified.tags,
      userId,
      classifiedAt: new Date().toISOString(),
      _lang: DB_LANGUAGE,
    }

    if (this.storageMode === 'cloud' && this.cloudAdapter) {
      const key = `memory_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      await this.cloudAdapter.put(key, { content: classified.content, ...metadata })
    } else {
      await this.memory.insertMemory(classified.content, metadata)
      if (this.storageMode === 'hybrid' && this.cloudAdapter && classified.importance >= 0.6) {
        const key = `memory_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        await this.cloudAdapter.put(key, { content: classified.content, ...metadata }).catch(() => {})
      }
    }
  }

  /**
   * Search memories with type filtering and importance weighting.
   */
  async search(
    query: string,
    options: FederatedSearchOptions = {},
  ): Promise<FederatedMemoryResult[]> {
    const {
      types,
      topK = 10,
      minImportance = 0,
      userId,
      boostTypes,
    } = options

    // Fetch more than needed so we can filter/re-rank
    const fetchK = Math.min(topK * 3, 50)
    const raw = await this.memory.semanticSearch(query, fetchK)

    let results: FederatedMemoryResult[] = raw.map((m: Memory, index: number) => {
      const memType = (m.metadata.memoryType as MemoryType) ?? 'semantic'
      const importance = (m.metadata.importance as number) ?? 0.5
      const tags = (m.metadata.tags as string[]) ?? []

      // Base score: inverse of rank (higher is better)
      let score = 1 - (index / fetchK)

      // Boost by type if requested
      if (boostTypes && boostTypes[memType]) {
        score *= boostTypes[memType]!
      }

      // Boost by importance
      score *= (0.5 + importance * 0.5)

      return {
        content: m.content,
        type: memType,
        importance,
        tags,
        score,
        metadata: m.metadata,
      }
    })

    // Filter by type
    if (types && types.length > 0) {
      const typeSet = new Set(types)
      results = results.filter(r => typeSet.has(r.type))
    }

    // Filter by importance
    if (minImportance > 0) {
      results = results.filter(r => r.importance >= minImportance)
    }

    // Filter by userId
    if (userId) {
      results = results.filter(r => r.metadata.userId === userId)
    }

    // Sort by score descending and limit
    results.sort((a, b) => b.score - a.score)
    return results.slice(0, topK)
  }

  /**
   * Search specifically for procedural memories (how-to knowledge).
   */
  async recallProcedure(query: string, topK = 3): Promise<string[]> {
    const results = await this.search(query, {
      types: ['procedural'],
      topK,
      boostTypes: { procedural: 1.5 },
    })
    return results.map(r => r.content)
  }

  /**
   * Search for episodic memories (past events/interactions).
   */
  async recallEpisodes(query: string, userId?: string, topK = 5): Promise<string[]> {
    const results = await this.search(query, {
      types: ['episodic'],
      topK,
      userId,
      boostTypes: { episodic: 1.5 },
    })
    return results.map(r => r.content)
  }

  /**
   * Search for semantic memories (facts/knowledge).
   */
  async recallFacts(query: string, topK = 5): Promise<string[]> {
    const results = await this.search(query, {
      types: ['semantic'],
      topK,
      boostTypes: { semantic: 1.5 },
    })
    return results.map(r => r.content)
  }

  /**
   * Broad search across all memory types with default weighting.
   * Returns a formatted context string ready for LLM injection.
   */
  async recallContext(query: string, topK = 8): Promise<string> {
    const results = await this.search(query, { topK })

    if (results.length === 0) return ''

    const lines = results.map(r =>
      `[${r.type}] ${r.content}`
    )

    return lines.join('\n')
  }
}
