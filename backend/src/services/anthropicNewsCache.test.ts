import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockGet, mockSet, mockDoc, mockDb } = vi.hoisted(() => {
  const mockGet = vi.fn()
  const mockSet = vi.fn()
  const mockDoc = vi.fn().mockReturnValue({ get: mockGet, set: mockSet })
  const mockDb = { collection: vi.fn().mockReturnValue({ doc: mockDoc }) }
  return { mockGet, mockSet, mockDoc, mockDb }
})

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: vi.fn(() => mockDb),
  Timestamp: {
    now: vi.fn(() => ({ toDate: () => new Date() })),
  },
}))

const { mockFetchAnthropicNews } = vi.hoisted(() => ({ mockFetchAnthropicNews: vi.fn() }))
vi.mock('../tools/anthropicNews', () => ({
  fetchAnthropicNews: mockFetchAnthropicNews,
}))

import { getCachedPosts, setCachedPosts, getAnthropicNews } from './anthropicNewsCache'

const samplePosts = [
  { title: 'Introducing Claude Opus 5', url: 'https://www.anthropic.com/news/claude-opus-5', publishedAt: '2026-07-24T04:00:00.000Z' },
]

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getCachedPosts', () => {
  it('returns null when no cache document exists', async () => {
    mockGet.mockResolvedValueOnce({ exists: false })
    expect(await getCachedPosts()).toBeNull()
  })

  it('returns cached posts when within TTL', async () => {
    mockGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        posts: samplePosts,
        fetchedAt: { toDate: () => new Date() },
      }),
    })
    expect(await getCachedPosts()).toEqual(samplePosts)
  })

  it('returns null when cache is older than 24 hours', async () => {
    mockGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        posts: samplePosts,
        fetchedAt: { toDate: () => new Date(Date.now() - 25 * 60 * 60 * 1000) },
      }),
    })
    expect(await getCachedPosts()).toBeNull()
  })
})

describe('setCachedPosts', () => {
  it('writes posts to the cache document', async () => {
    await setCachedPosts(samplePosts)
    expect(mockDb.collection).toHaveBeenCalledWith('anthropic_news_cache')
    expect(mockDoc).toHaveBeenCalledWith('posts')
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ posts: samplePosts }))
  })
})

describe('getAnthropicNews', () => {
  it('returns cached posts without calling fetchAnthropicNews on a hit', async () => {
    mockGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        posts: samplePosts,
        fetchedAt: { toDate: () => new Date() },
      }),
    })
    const result = await getAnthropicNews()
    expect(result).toEqual(samplePosts)
    expect(mockFetchAnthropicNews).not.toHaveBeenCalled()
  })

  it('fetches fresh posts and populates the cache on a miss', async () => {
    mockGet.mockResolvedValueOnce({ exists: false })
    mockFetchAnthropicNews.mockResolvedValueOnce(samplePosts)
    const result = await getAnthropicNews()
    expect(mockFetchAnthropicNews).toHaveBeenCalled()
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ posts: samplePosts }))
    expect(result).toEqual(samplePosts)
  })
})
