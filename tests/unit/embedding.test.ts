import { describe, it, expect } from 'vitest'
import { deterministicEmbed, cosineSimilarity } from '../../src/memoryLayer.js'

describe('deterministicEmbed', () => {
  it('produces 384-dimensional vector', async () => {
    const vec = await deterministicEmbed('hello world')
    expect(vec.length).toBe(384)
  })

  it('produces normalized vectors (L2 norm ≈ 1)', async () => {
    const vec = await deterministicEmbed('test input')
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0))
    expect(norm).toBeCloseTo(1.0, 3)
  })

  it('produces identical vectors for identical text', async () => {
    const a = await deterministicEmbed('same text')
    const b = await deterministicEmbed('same text')
    expect(a).toEqual(b)
  })

  it('produces different vectors for different text', async () => {
    const a = await deterministicEmbed('hello world')
    const b = await deterministicEmbed('goodbye moon')
    expect(a).not.toEqual(b)
  })

  it('handles empty string', async () => {
    const vec = await deterministicEmbed('')
    expect(vec.length).toBe(384)
    // All zeros, but normalized — so should be all 0s (since norm is 1 by fallback)
    expect(vec.every(v => v === 0)).toBe(true)
  })
})

describe('cosineSimilarity', () => {
  it('returns 1.0 for identical vectors', () => {
    const v = [1, 0, 0]
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 5)
  })

  it('returns 0.0 for orthogonal vectors', () => {
    const a = [1, 0, 0]
    const b = [0, 1, 0]
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.0, 5)
  })

  it('returns -1.0 for opposite vectors', () => {
    const a = [1, 0]
    const b = [-1, 0]
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0, 5)
  })

  it('handles vectors of different lengths gracefully', () => {
    const a = [1, 0, 0]
    const b = [1, 0]
    // Should use min length
    const result = cosineSimilarity(a, b)
    expect(typeof result).toBe('number')
    expect(isNaN(result)).toBe(false)
  })

  it('returns correct similarity for real-world-like vectors', () => {
    const a = [0.5, 0.3, 0.2, 0.1]
    const b = [0.4, 0.3, 0.25, 0.15]
    const sim = cosineSimilarity(a, b)
    expect(sim).toBeGreaterThan(0.95) // Very similar vectors
    expect(sim).toBeLessThanOrEqual(1.0)
  })

  it('similar texts have higher cosine similarity than dissimilar', async () => {
    const embA = await deterministicEmbed('machine learning algorithms')
    const embB = await deterministicEmbed('machine learning models')
    const embC = await deterministicEmbed('cooking pasta recipes')

    const simAB = cosineSimilarity(embA, embB)
    const simAC = cosineSimilarity(embA, embC)

    expect(simAB).toBeGreaterThan(simAC)
  })
})
