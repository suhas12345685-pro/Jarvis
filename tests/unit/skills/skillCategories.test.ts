import { describe, it, expect, vi, beforeAll } from 'vitest'

// Mock skills/index.js to provide a known set of skills
vi.mock('../../../src/skills/index.js', () => {
  const defs = [
    { name: 'memory_store', description: 'Store memory', inputSchema: {} },
    { name: 'memory_recall', description: 'Recall memory', inputSchema: {} },
    { name: 'adaptive_reasoning', description: 'Reason adaptively', inputSchema: {} },
    { name: 'headless_browser', description: 'Browse web pages', inputSchema: {} },
    { name: 'web_search', description: 'Search the web', inputSchema: {} },
    { name: 'api_fetch', description: 'Fetch APIs', inputSchema: {} },
    { name: 'os_terminal', description: 'Run shell commands', inputSchema: {} },
    { name: 'local_file_read', description: 'Read files', inputSchema: {} },
    { name: 'system_info', description: 'System information', inputSchema: {} },
    { name: 'send_email', description: 'Send email', inputSchema: {} },
    { name: 'slack_send', description: 'Send Slack message', inputSchema: {} },
    { name: 'stripe_list_charges', description: 'List Stripe charges', inputSchema: {} },
    { name: 'git_status', description: 'Git status', inputSchema: {} },
    { name: 'docker_list', description: 'List Docker containers', inputSchema: {} },
    { name: 'data_parse_csv', description: 'Parse CSV', inputSchema: {} },
    { name: 'image_resize', description: 'Resize images', inputSchema: {} },
    { name: 'pdf_extract', description: 'Extract PDF text', inputSchema: {} },
    { name: 'translate_text', description: 'Translate text', inputSchema: {} },
    { name: 'deploy_agents', description: 'Deploy agent swarm', inputSchema: {} },
    { name: 'custom_auto_skill', description: 'Auto-generated skill', inputSchema: {} },
  ]
  return {
    getAllDefinitions: () => defs,
    getSkill: vi.fn(),
    registerSkill: vi.fn(),
  }
})

describe('skillCategories', () => {
  let classifyIntent: typeof import('../../../src/skills/skillCategories.js').classifyIntent
  let getToolsForCategories: typeof import('../../../src/skills/skillCategories.js').getToolsForCategories
  let summarizeSelection: typeof import('../../../src/skills/skillCategories.js').summarizeSelection
  let registerSkillCategory: typeof import('../../../src/skills/skillCategories.js').registerSkillCategory

  beforeAll(async () => {
    const mod = await import('../../../src/skills/skillCategories.js')
    classifyIntent = mod.classifyIntent
    getToolsForCategories = mod.getToolsForCategories
    summarizeSelection = mod.summarizeSelection
    registerSkillCategory = mod.registerSkillCategory
  })

  // ── classifyIntent ──────────────────────────────────────────────────────

  it('always includes core category', () => {
    const cats = classifyIntent('browse https://example.com')
    expect(cats).toContain('core')
  })

  it('classifies web-related messages', () => {
    const cats = classifyIntent('scrape https://example.com and search for news')
    expect(cats).toContain('web')
  })

  it('classifies OS-related messages', () => {
    const cats = classifyIntent('run this shell command: ls -la')
    expect(cats).toContain('os')
  })

  it('classifies communication messages', () => {
    const cats = classifyIntent('send an email to john@example.com')
    expect(cats).toContain('comms')
  })

  it('classifies payment messages', () => {
    const cats = classifyIntent('create a stripe payment intent for $50')
    expect(cats).toContain('business')
  })

  it('classifies devops messages', () => {
    const cats = classifyIntent('git commit and push to the repository')
    expect(cats).toContain('devops')
  })

  it('classifies data messages', () => {
    const cats = classifyIntent('parse this csv file and compute statistics')
    expect(cats).toContain('data')
  })

  it('classifies media messages', () => {
    const cats = classifyIntent('resize this image and generate a PDF')
    expect(cats).toContain('media')
  })

  it('classifies multi-category messages', () => {
    const cats = classifyIntent('web search for news and send email with the results')
    expect(cats).toContain('web')
    expect(cats).toContain('comms')
  })

  it('falls back to all categories for ambiguous messages', () => {
    const cats = classifyIntent('hello how are you today')
    // Should include all categories since nothing matched
    expect(cats.length).toBe(10)
  })

  // ── getToolsForCategories ───────────────────────────────────────────────

  it('returns only core tools when only core is requested', () => {
    const tools = getToolsForCategories(['core'])
    const names = tools.map(t => t.name)
    expect(names).toContain('memory_store')
    expect(names).toContain('adaptive_reasoning')
    expect(names).not.toContain('headless_browser')
    expect(names).not.toContain('os_terminal')
  })

  it('returns core + web tools for web category', () => {
    const tools = getToolsForCategories(['core', 'web'])
    const names = tools.map(t => t.name)
    expect(names).toContain('memory_store')
    expect(names).toContain('headless_browser')
    expect(names).toContain('web_search')
    expect(names).not.toContain('os_terminal')
    expect(names).not.toContain('send_email')
  })

  it('includes unknown skills when agents category is active', () => {
    const tools = getToolsForCategories(['core', 'agents'])
    const names = tools.map(t => t.name)
    expect(names).toContain('deploy_agents')
    expect(names).toContain('custom_auto_skill') // unknown → included with agents
  })

  it('includes unknown skills when all categories requested', () => {
    const allCats = ['core', 'web', 'os', 'comms', 'business', 'data', 'devops', 'media', 'planning', 'agents'] as const
    const tools = getToolsForCategories([...allCats])
    const names = tools.map(t => t.name)
    expect(names).toContain('custom_auto_skill')
  })

  it('returns fewer tools than total when filtering', () => {
    const allTools = getToolsForCategories(['core', 'web', 'os', 'comms', 'business', 'data', 'devops', 'media', 'planning', 'agents'])
    const webOnly = getToolsForCategories(['core', 'web'])
    expect(webOnly.length).toBeLessThan(allTools.length)
  })

  // ── summarizeSelection ──────────────────────────────────────────────────

  it('produces human-readable summary', () => {
    const summary = summarizeSelection(['core', 'web'])
    expect(summary).toContain('core')
    expect(summary).toContain('web')
    expect(summary).toContain('tools')
  })

  // ── registerSkillCategory ───────────────────────────────────────────────

  it('allows registering new skill→category mappings', () => {
    registerSkillCategory('custom_auto_skill', 'web')
    // Now custom_auto_skill should appear in web category
    const tools = getToolsForCategories(['core', 'web'])
    const names = tools.map(t => t.name)
    expect(names).toContain('custom_auto_skill')
  })
})
