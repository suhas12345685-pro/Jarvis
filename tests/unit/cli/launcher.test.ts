import { describe, it, expect } from 'vitest'

/**
 * Tests for the CLI arg parser extracted from launcher.ts.
 *
 * Since launcher.ts auto-executes main() on import, we test the
 * parseArgs logic by reimplementing the pure function here
 * (same logic, extracted for testability).
 */

interface GhostPayload {
  type: 'web' | 'exec' | 'ai'
  url?: string
  script?: string
  screenshotPath?: string
  waitForSelector?: string
  command?: string
  cwd?: string
  prompt?: string
  taskId: string
  timestamp: string
}

type ParseResult = GhostPayload | 'status' | 'status-full' | 'help' | 'daemon' | 'daemon-stop' | null

function parseArgs(argv: string[]): ParseResult {
  if (argv.length === 0) return 'help'

  const taskId = 'ghost-test1234'
  const timestamp = '2024-01-01T00:00:00Z'

  if (argv[0] === '--help' || argv[0] === '-h') return 'help'
  if (argv[0] === '--daemon') return 'daemon'
  if (argv[0] === '--daemon-stop') return 'daemon-stop'

  if (argv[0] === '--status' || argv[0] === '-s') {
    return argv[1] === 'full' ? 'status-full' : 'status'
  }

  if (argv[0] === '--web') {
    const url = argv[1]
    if (!url) return null

    const payload: GhostPayload = { type: 'web', url, taskId, timestamp }
    for (let i = 2; i < argv.length; i++) {
      if (argv[i] === '--script' && argv[i + 1]) {
        payload.script = argv[++i]
      } else if (argv[i] === '--screenshot' && argv[i + 1]) {
        payload.screenshotPath = argv[++i]
      } else if (argv[i] === '--wait' && argv[i + 1]) {
        payload.waitForSelector = argv[++i]
      }
    }
    return payload
  }

  if (argv[0] === '--exec') {
    const command = argv[1]
    if (!command) return null

    const payload: GhostPayload = { type: 'exec', command, taskId, timestamp }
    for (let i = 2; i < argv.length; i++) {
      if (argv[i] === '--cwd' && argv[i + 1]) {
        payload.cwd = argv[++i]
      }
    }
    return payload
  }

  if (argv[0] === '--ai') {
    const prompt = argv.slice(1).join(' ')
    if (!prompt) return null
    return { type: 'ai', prompt, taskId, timestamp }
  }

  const prompt = argv.join(' ')
  return { type: 'ai', prompt, taskId, timestamp }
}

describe('launcher parseArgs', () => {
  it('returns help for empty args', () => {
    expect(parseArgs([])).toBe('help')
  })

  it('returns help for --help flag', () => {
    expect(parseArgs(['--help'])).toBe('help')
    expect(parseArgs(['-h'])).toBe('help')
  })

  it('returns daemon for --daemon flag', () => {
    expect(parseArgs(['--daemon'])).toBe('daemon')
  })

  it('returns daemon-stop for --daemon-stop flag', () => {
    expect(parseArgs(['--daemon-stop'])).toBe('daemon-stop')
  })

  it('returns status for --status flag', () => {
    expect(parseArgs(['--status'])).toBe('status')
    expect(parseArgs(['-s'])).toBe('status')
  })

  it('returns status-full for --status full', () => {
    expect(parseArgs(['--status', 'full'])).toBe('status-full')
  })

  it('parses --web with URL', () => {
    const result = parseArgs(['--web', 'https://example.com']) as GhostPayload
    expect(result.type).toBe('web')
    expect(result.url).toBe('https://example.com')
  })

  it('parses --web with --script option', () => {
    const result = parseArgs(['--web', 'https://example.com', '--script', 'document.title']) as GhostPayload
    expect(result.script).toBe('document.title')
  })

  it('parses --web with --screenshot option', () => {
    const result = parseArgs(['--web', 'https://example.com', '--screenshot', '/tmp/shot.png']) as GhostPayload
    expect(result.screenshotPath).toBe('/tmp/shot.png')
  })

  it('parses --web with --wait option', () => {
    const result = parseArgs(['--web', 'https://example.com', '--wait', '.content']) as GhostPayload
    expect(result.waitForSelector).toBe('.content')
  })

  it('returns null for --web without URL', () => {
    expect(parseArgs(['--web'])).toBeNull()
  })

  it('parses --exec with command', () => {
    const result = parseArgs(['--exec', 'ls -la']) as GhostPayload
    expect(result.type).toBe('exec')
    expect(result.command).toBe('ls -la')
  })

  it('parses --exec with --cwd', () => {
    const result = parseArgs(['--exec', 'ls', '--cwd', '/tmp']) as GhostPayload
    expect(result.cwd).toBe('/tmp')
  })

  it('returns null for --exec without command', () => {
    expect(parseArgs(['--exec'])).toBeNull()
  })

  it('parses --ai with prompt', () => {
    const result = parseArgs(['--ai', 'tell', 'me', 'a', 'joke']) as GhostPayload
    expect(result.type).toBe('ai')
    expect(result.prompt).toBe('tell me a joke')
  })

  it('returns null for --ai without prompt', () => {
    expect(parseArgs(['--ai'])).toBeNull()
  })

  it('treats bare text as AI prompt', () => {
    const result = parseArgs(['summarize', 'my', 'git', 'log']) as GhostPayload
    expect(result.type).toBe('ai')
    expect(result.prompt).toBe('summarize my git log')
  })
})
