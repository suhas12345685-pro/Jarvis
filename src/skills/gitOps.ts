import { registerSkill } from './index.js'
import type { AgentContext, SkillResult } from '../types/index.js'
import { execSync } from 'child_process'
import { resolve } from 'path'
import { homedir } from 'os'

const WORKSPACE = resolve(homedir(), 'jarvis-workspace')

function runGit(args: string, cwd?: string): string {
  return execSync(`git ${args}`, {
    cwd: cwd ?? WORKSPACE,
    timeout: 30_000,
    encoding: 'utf-8',
  }).trim()
}

registerSkill({
  name: 'git_status',
  description: 'Get the git status of a repository.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Repository path (default: workspace)' },
    },
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    try {
      const cwd = input.path ? resolve(String(input.path)) : WORKSPACE
      const output = runGit('status --short', cwd)
      const branch = runGit('branch --show-current', cwd)
      return { output: `Branch: ${branch}\n\n${output || 'Working tree clean'}`, isError: false }
    } catch (err) {
      return { output: `Git error: ${(err as Error).message}`, isError: true }
    }
  },
})

registerSkill({
  name: 'git_log',
  description: 'View recent git commits.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Repository path' },
      count: { type: 'number', description: 'Number of commits to show (default: 10)' },
    },
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    try {
      const cwd = input.path ? resolve(String(input.path)) : WORKSPACE
      const count = Math.min(Number(input.count ?? 10), 50)
      const output = runGit(`log --oneline -${count}`, cwd)
      return { output, isError: false }
    } catch (err) {
      return { output: `Git error: ${(err as Error).message}`, isError: true }
    }
  },
})

registerSkill({
  name: 'git_diff',
  description: 'Show git diff (staged or unstaged changes).',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Repository path' },
      staged: { type: 'boolean', description: 'Show staged changes only (default: false)' },
    },
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    try {
      const cwd = input.path ? resolve(String(input.path)) : WORKSPACE
      const flag = input.staged ? '--staged' : ''
      const output = runGit(`diff ${flag}`, cwd)
      return { output: output.slice(0, 8000) || 'No changes', isError: false }
    } catch (err) {
      return { output: `Git error: ${(err as Error).message}`, isError: true }
    }
  },
})

registerSkill({
  name: 'git_clone',
  description: 'Clone a git repository into the workspace.',
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Repository URL' },
      name: { type: 'string', description: 'Directory name (default: auto from URL)' },
    },
    required: ['url'],
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    const url = String(input.url)
    // Basic URL validation
    if (!url.startsWith('http') && !url.startsWith('git@')) {
      return { output: 'Invalid repository URL', isError: true }
    }

    try {
      const args = input.name ? `clone ${url} ${String(input.name)}` : `clone ${url}`
      const output = execSync(`git ${args}`, {
        cwd: WORKSPACE,
        timeout: 120_000,
        encoding: 'utf-8',
      }).trim()
      return { output: output || 'Repository cloned successfully', isError: false }
    } catch (err) {
      return { output: `Clone error: ${(err as Error).message}`, isError: true }
    }
  },
})
