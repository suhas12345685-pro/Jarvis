import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock @aws-sdk/client-s3
const mockSend = vi.fn()
const MockS3Client = vi.fn().mockReturnValue({ send: mockSend })
const MockListObjectsV2Command = vi.fn()
const MockPutObjectCommand = vi.fn()
const MockGetObjectCommand = vi.fn()
const MockDeleteObjectCommand = vi.fn()

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: MockS3Client,
  ListObjectsV2Command: MockListObjectsV2Command,
  PutObjectCommand: MockPutObjectCommand,
  GetObjectCommand: MockGetObjectCommand,
  DeleteObjectCommand: MockDeleteObjectCommand,
}))

vi.mock('../../../src/logger.js', () => ({
  getLogger: () => ({ error: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn() }),
}))

import { getSkill } from '../../../src/skills/index.js'
import '../../../src/skills/cloudStorage.js'

const ctx: any = { userId: 'u1', channelType: 'test', threadId: 't1', memories: [] }

describe('cloudStorage skills', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('cloud_list', () => {
    const skill = getSkill('cloud_list')!

    it('lists objects in bucket', async () => {
      mockSend.mockResolvedValue({
        Contents: [
          { Key: 'file1.txt', Size: 1024, LastModified: new Date('2025-01-01') },
          { Key: 'file2.txt', Size: 2048, LastModified: new Date('2025-01-02') },
        ],
      })
      const res = await skill.handler({ bucket: 'my-bucket', access_key: 'key', secret_key: 'secret' }, ctx)
      expect(res.isError).toBe(false)
      const parsed = JSON.parse(res.output)
      expect(parsed.count).toBe(2)
      expect(parsed.objects[0].key).toBe('file1.txt')
    })

    it('handles empty bucket', async () => {
      mockSend.mockResolvedValue({ Contents: undefined })
      const res = await skill.handler({ bucket: 'empty-bucket' }, ctx)
      expect(res.isError).toBe(false)
      expect(JSON.parse(res.output).count).toBe(0)
    })

    it('uses custom endpoint for MinIO/R2', async () => {
      mockSend.mockResolvedValue({ Contents: [] })
      await skill.handler({ bucket: 'b', endpoint: 'http://minio:9000', access_key: 'k', secret_key: 's' }, ctx)
      expect(MockS3Client).toHaveBeenCalledWith(expect.objectContaining({
        endpoint: 'http://minio:9000',
        forcePathStyle: true,
      }))
    })

    it('handles S3 errors', async () => {
      mockSend.mockRejectedValue(new Error('Access Denied'))
      const res = await skill.handler({ bucket: 'private-bucket' }, ctx)
      expect(res.isError).toBe(true)
      expect(res.output).toContain('Access Denied')
    })
  })

  describe('cloud_upload', () => {
    const skill = getSkill('cloud_upload')!

    it('uploads text content', async () => {
      mockSend.mockResolvedValue({})
      const res = await skill.handler({ bucket: 'b', key: 'test.txt', content: 'hello', access_key: 'k', secret_key: 's' }, ctx)
      expect(res.isError).toBe(false)
      expect(res.output).toContain('Uploaded to s3://b/test.txt')
    })

    it('passes content type', async () => {
      mockSend.mockResolvedValue({})
      await skill.handler({ bucket: 'b', key: 'data.json', content: '{}', content_type: 'application/json', access_key: 'k', secret_key: 's' }, ctx)
      expect(MockPutObjectCommand).toHaveBeenCalledWith(expect.objectContaining({
        ContentType: 'application/json',
      }))
    })

    it('handles upload errors', async () => {
      mockSend.mockRejectedValue(new Error('Bucket not found'))
      const res = await skill.handler({ bucket: 'missing', key: 'f', content: 'x' }, ctx)
      expect(res.isError).toBe(true)
      expect(res.output).toContain('Bucket not found')
    })
  })

  describe('cloud_download', () => {
    const skill = getSkill('cloud_download')!

    it('downloads and returns content', async () => {
      mockSend.mockResolvedValue({
        Body: { transformToString: () => Promise.resolve('file contents here') },
      })
      const res = await skill.handler({ bucket: 'b', key: 'test.txt', access_key: 'k', secret_key: 's' }, ctx)
      expect(res.isError).toBe(false)
      expect(res.output).toBe('file contents here')
    })

    it('truncates large content', async () => {
      mockSend.mockResolvedValue({
        Body: { transformToString: () => Promise.resolve('x'.repeat(60000)) },
      })
      const res = await skill.handler({ bucket: 'b', key: 'big.txt', access_key: 'k', secret_key: 's' }, ctx)
      expect(res.output).toContain('truncated')
      expect(res.output.length).toBeLessThan(60000)
    })
  })

  describe('cloud_delete', () => {
    const skill = getSkill('cloud_delete')!

    it('deletes an object', async () => {
      mockSend.mockResolvedValue({})
      const res = await skill.handler({ bucket: 'b', key: 'old.txt', access_key: 'k', secret_key: 's' }, ctx)
      expect(res.isError).toBe(false)
      expect(res.output).toContain('Deleted s3://b/old.txt')
    })

    it('handles delete errors', async () => {
      mockSend.mockRejectedValue(new Error('Not Found'))
      const res = await skill.handler({ bucket: 'b', key: 'missing' }, ctx)
      expect(res.isError).toBe(true)
    })
  })
})
