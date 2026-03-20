/**
 * Archive skills — create, extract, and inspect archives (zip, tar, tar.gz).
 */
import { registerSkill } from './index.js'
import type { AgentContext, SkillResult } from '../types/index.js'
import { execSync } from 'child_process'
import { statSync, existsSync } from 'fs'
import { escapeShellArg } from '../security.js'

function shellExec(cmd: string, timeout = 30000): string {
  return execSync(cmd, { timeout, encoding: 'utf-8', maxBuffer: 1024 * 1024 * 10 }).trim()
}

registerSkill({
  name: 'archive_create',
  description: 'Create an archive (zip, tar, tar.gz) from files or directories.',
  inputSchema: {
    type: 'object',
    properties: {
      output: { type: 'string', description: 'Output archive path (e.g., backup.zip, files.tar.gz)' },
      sources: {
        type: 'array',
        items: { type: 'string' },
        description: 'List of files/directories to include',
      },
      format: { type: 'string', description: 'Archive format: zip, tar, tar.gz, tar.bz2 (auto-detected from output extension)' },
    },
    required: ['output', 'sources'],
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    try {
      const rawOutputPath = String(input.output)
      const outputPath = escapeShellArg(rawOutputPath)
      const sources = (input.sources as string[]).map(s => escapeShellArg(String(s))).join(' ')

      let format = String(input.format || '')
      if (!format) {
        if (rawOutputPath.endsWith('.tar.gz') || rawOutputPath.endsWith('.tgz')) format = 'tar.gz'
        else if (rawOutputPath.endsWith('.tar.bz2')) format = 'tar.bz2'
        else if (rawOutputPath.endsWith('.tar')) format = 'tar'
        else format = 'zip'
      }

      let cmd: string
      switch (format) {
        case 'zip':
          cmd = `zip -r ${outputPath} ${sources}`
          break
        case 'tar':
          cmd = `tar cf ${outputPath} ${sources}`
          break
        case 'tar.gz':
          cmd = `tar czf ${outputPath} ${sources}`
          break
        case 'tar.bz2':
          cmd = `tar cjf ${outputPath} ${sources}`
          break
        default:
          return { output: `Unsupported format: ${format}`, isError: true }
      }

      shellExec(cmd)
      const stats = statSync(rawOutputPath)
      return {
        output: `Archive created: ${rawOutputPath} (${(stats.size / 1024).toFixed(1)} KB)`,
        isError: false,
        metadata: { path: rawOutputPath, size: stats.size, format },
      }
    } catch (err) {
      return { output: `Archive create error: ${(err as Error).message}`, isError: true }
    }
  },
})

registerSkill({
  name: 'archive_extract',
  description: 'Extract an archive (zip, tar, tar.gz, tar.bz2) to a directory.',
  inputSchema: {
    type: 'object',
    properties: {
      archive: { type: 'string', description: 'Path to the archive file' },
      destination: { type: 'string', description: 'Directory to extract to (default: current directory)' },
    },
    required: ['archive'],
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    try {
      const rawArchive = String(input.archive)
      const rawDest = String(input.destination || '.')
      const archive = escapeShellArg(rawArchive)
      const dest = escapeShellArg(rawDest)

      if (!existsSync(rawArchive)) {
        return { output: `Archive not found: ${rawArchive}`, isError: true }
      }

      let cmd: string
      if (rawArchive.endsWith('.zip')) {
        cmd = `unzip -o ${archive} -d ${dest}`
      } else if (rawArchive.endsWith('.tar.gz') || rawArchive.endsWith('.tgz')) {
        cmd = `tar xzf ${archive} -C ${dest}`
      } else if (rawArchive.endsWith('.tar.bz2')) {
        cmd = `tar xjf ${archive} -C ${dest}`
      } else if (rawArchive.endsWith('.tar')) {
        cmd = `tar xf ${archive} -C ${dest}`
      } else {
        return { output: `Unsupported archive format. Supported: .zip, .tar, .tar.gz, .tgz, .tar.bz2`, isError: true }
      }

      const output = shellExec(cmd, 60000)
      return { output: `Extracted to ${rawDest}\n${output}`, isError: false }
    } catch (err) {
      return { output: `Archive extract error: ${(err as Error).message}`, isError: true }
    }
  },
})

registerSkill({
  name: 'archive_list',
  description: 'List contents of an archive without extracting it.',
  inputSchema: {
    type: 'object',
    properties: {
      archive: { type: 'string', description: 'Path to the archive file' },
    },
    required: ['archive'],
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    try {
      const rawArchive = String(input.archive)
      const archive = escapeShellArg(rawArchive)

      if (!existsSync(rawArchive)) {
        return { output: `Archive not found: ${rawArchive}`, isError: true }
      }

      let cmd: string
      if (rawArchive.endsWith('.zip')) {
        cmd = `unzip -l ${archive}`
      } else if (rawArchive.endsWith('.tar.gz') || rawArchive.endsWith('.tgz')) {
        cmd = `tar tzf ${archive}`
      } else if (rawArchive.endsWith('.tar.bz2')) {
        cmd = `tar tjf ${archive}`
      } else if (rawArchive.endsWith('.tar')) {
        cmd = `tar tf ${archive}`
      } else {
        return { output: `Unsupported archive format`, isError: true }
      }

      const output = shellExec(cmd)
      const lines = output.split('\n')
      return {
        output: output,
        isError: false,
        metadata: { entries: lines.length },
      }
    } catch (err) {
      return { output: `Archive list error: ${(err as Error).message}`, isError: true }
    }
  },
})
