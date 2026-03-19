import { vi } from 'vitest'

const memoryStore: unknown[] = []

export const mockSupabase = {
  from: vi.fn().mockReturnThis(),
  insert: vi.fn().mockImplementation((data: unknown) => {
    memoryStore.push(data)
    return { error: null }
  }),
  delete: vi.fn().mockReturnThis(),
  eq: vi.fn().mockResolvedValue({ error: null }),
  rpc: vi.fn().mockImplementation((_fn: string, { match_count }: { match_count: number }) => ({
    data: memoryStore.slice(0, match_count).map((item, i) => ({
      id: `id-${i}`,
      content: (item as Record<string, unknown>)?.content ?? '',
      embedding: [],
      metadata: {},
      created_at: new Date().toISOString(),
    })),
    error: null,
  })),
}

export function clearMemoryStore() {
  memoryStore.length = 0
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn().mockReturnValue(mockSupabase),
}))
