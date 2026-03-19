/**
 * Cloud storage skills — S3-compatible operations (AWS S3, MinIO, R2, etc.)
 */
import { registerSkill } from './index.js'
import type { AgentContext, SkillResult } from '../types/index.js'
import { getLogger } from '../logger.js'

function getS3Config(input: Record<string, unknown>): { endpoint?: string; region: string; bucket: string; accessKey: string; secretKey: string } {
  return {
    endpoint: input.endpoint ? String(input.endpoint) : undefined,
    region: String(input.region || 'us-east-1'),
    bucket: String(input.bucket),
    accessKey: String(input.access_key || process.env.AWS_ACCESS_KEY_ID || ''),
    secretKey: String(input.secret_key || process.env.AWS_SECRET_ACCESS_KEY || ''),
  }
}

registerSkill({
  name: 'cloud_list',
  description: 'List objects in an S3-compatible bucket (AWS S3, MinIO, Cloudflare R2).',
  inputSchema: {
    type: 'object',
    properties: {
      bucket: { type: 'string', description: 'Bucket name' },
      prefix: { type: 'string', description: 'Key prefix to filter by' },
      region: { type: 'string', description: 'AWS region (default: us-east-1)' },
      endpoint: { type: 'string', description: 'Custom endpoint URL for MinIO/R2' },
      access_key: { type: 'string', description: 'Access key (or uses AWS_ACCESS_KEY_ID env var)' },
      secret_key: { type: 'string', description: 'Secret key (or uses AWS_SECRET_ACCESS_KEY env var)' },
      max_keys: { type: 'number', description: 'Maximum number of objects to list (default: 100)' },
    },
    required: ['bucket'],
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    const logger = getLogger()
    try {
      const { S3Client, ListObjectsV2Command } = await import('@aws-sdk/client-s3')
      const cfg = getS3Config(input)
      const client = new S3Client({
        region: cfg.region,
        ...(cfg.endpoint ? { endpoint: cfg.endpoint, forcePathStyle: true } : {}),
        credentials: cfg.accessKey ? { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey } : undefined,
      })

      const result = await client.send(new ListObjectsV2Command({
        Bucket: cfg.bucket,
        Prefix: input.prefix ? String(input.prefix) : undefined,
        MaxKeys: Number(input.max_keys || 100),
      }))

      const objects = (result.Contents || []).map((obj: any) => ({
        key: obj.Key,
        size: obj.Size,
        lastModified: obj.LastModified?.toISOString(),
      }))

      return {
        output: JSON.stringify({ count: objects.length, objects }, null, 2),
        isError: false,
        metadata: { count: objects.length },
      }
    } catch (err) {
      logger.error('cloud_list failed', { error: (err as Error).message })
      return { output: `S3 list error: ${(err as Error).message}`, isError: true }
    }
  },
})

registerSkill({
  name: 'cloud_upload',
  description: 'Upload a file or text content to an S3-compatible bucket.',
  inputSchema: {
    type: 'object',
    properties: {
      bucket: { type: 'string', description: 'Bucket name' },
      key: { type: 'string', description: 'Object key (path in bucket)' },
      content: { type: 'string', description: 'Text content to upload' },
      file_path: { type: 'string', description: 'Local file path to upload (alternative to content)' },
      content_type: { type: 'string', description: 'MIME type (default: text/plain)' },
      region: { type: 'string' },
      endpoint: { type: 'string' },
      access_key: { type: 'string' },
      secret_key: { type: 'string' },
    },
    required: ['bucket', 'key'],
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    try {
      const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3')
      const cfg = getS3Config(input)
      const client = new S3Client({
        region: cfg.region,
        ...(cfg.endpoint ? { endpoint: cfg.endpoint, forcePathStyle: true } : {}),
        credentials: cfg.accessKey ? { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey } : undefined,
      })

      let body: string | Buffer
      if (input.file_path) {
        const { readFileSync } = await import('fs')
        body = readFileSync(String(input.file_path))
      } else {
        body = String(input.content || '')
      }

      await client.send(new PutObjectCommand({
        Bucket: cfg.bucket,
        Key: String(input.key),
        Body: body,
        ContentType: String(input.content_type || 'text/plain'),
      }))

      return { output: `Uploaded to s3://${cfg.bucket}/${input.key}`, isError: false }
    } catch (err) {
      return { output: `S3 upload error: ${(err as Error).message}`, isError: true }
    }
  },
})

registerSkill({
  name: 'cloud_download',
  description: 'Download an object from an S3-compatible bucket.',
  inputSchema: {
    type: 'object',
    properties: {
      bucket: { type: 'string', description: 'Bucket name' },
      key: { type: 'string', description: 'Object key' },
      save_path: { type: 'string', description: 'Local path to save file (optional — if omitted returns content as text)' },
      region: { type: 'string' },
      endpoint: { type: 'string' },
      access_key: { type: 'string' },
      secret_key: { type: 'string' },
    },
    required: ['bucket', 'key'],
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    try {
      const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3')
      const cfg = getS3Config(input)
      const client = new S3Client({
        region: cfg.region,
        ...(cfg.endpoint ? { endpoint: cfg.endpoint, forcePathStyle: true } : {}),
        credentials: cfg.accessKey ? { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey } : undefined,
      })

      const result = await client.send(new GetObjectCommand({
        Bucket: cfg.bucket,
        Key: String(input.key),
      }))

      const bodyStr = await result.Body?.transformToString() ?? ''

      if (input.save_path) {
        const { writeFileSync } = await import('fs')
        writeFileSync(String(input.save_path), bodyStr)
        return { output: `Downloaded to ${input.save_path} (${bodyStr.length} bytes)`, isError: false }
      }

      // Return content directly (truncate if huge)
      const truncated = bodyStr.length > 50000 ? bodyStr.slice(0, 50000) + '\n... (truncated)' : bodyStr
      return { output: truncated, isError: false, metadata: { size: bodyStr.length } }
    } catch (err) {
      return { output: `S3 download error: ${(err as Error).message}`, isError: true }
    }
  },
})

registerSkill({
  name: 'cloud_delete',
  description: 'Delete an object from an S3-compatible bucket.',
  inputSchema: {
    type: 'object',
    properties: {
      bucket: { type: 'string', description: 'Bucket name' },
      key: { type: 'string', description: 'Object key to delete' },
      region: { type: 'string' },
      endpoint: { type: 'string' },
      access_key: { type: 'string' },
      secret_key: { type: 'string' },
    },
    required: ['bucket', 'key'],
  },
  handler: async (input: Record<string, unknown>, _ctx: AgentContext): Promise<SkillResult> => {
    try {
      const { S3Client, DeleteObjectCommand } = await import('@aws-sdk/client-s3')
      const cfg = getS3Config(input)
      const client = new S3Client({
        region: cfg.region,
        ...(cfg.endpoint ? { endpoint: cfg.endpoint, forcePathStyle: true } : {}),
        credentials: cfg.accessKey ? { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey } : undefined,
      })

      await client.send(new DeleteObjectCommand({
        Bucket: cfg.bucket,
        Key: String(input.key),
      }))

      return { output: `Deleted s3://${cfg.bucket}/${input.key}`, isError: false }
    } catch (err) {
      return { output: `S3 delete error: ${(err as Error).message}`, isError: true }
    }
  },
})
