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

const { mockFetchTopStories } = vi.hoisted(() => ({ mockFetchTopStories: vi.fn() }))
vi.mock('../tools/hackernews', () => ({
  fetchTopStories: mockFetchTopStories,
}))

import { getCachedStories, setCachedStories, getHNStories } from './hnCache'

const sampleStories = [
  { id: '1', title: 'Story', url: 'https://example.com', points: 100, comments: 10 },
]

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getCachedStories', () => {
  it('returns null when no cache document exists', async () => {
    mockGet.mockResolvedValueOnce({ exists: false })
    expect(await getCachedStories()).toBeNull()
  })

  it('returns cached stories when within TTL', async () => {
    mockGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        stories: sampleStories,
        fetchedAt: { toDate: () => new Date() },
      }),
    })
    expect(await getCachedStories()).toEqual(sampleStories)
  })

  it('returns null when cache is stale', async () => {
    mockGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        stories: sampleStories,
        fetchedAt: { toDate: () => new Date(Date.now() - 7 * 60 * 60 * 1000) },
      }),
    })
    expect(await getCachedStories()).toBeNull()
  })
})

describe('setCachedStories', () => {
  it('writes stories to the cache document', async () => {
    await setCachedStories(sampleStories)
    expect(mockDb.collection).toHaveBeenCalledWith('hn_cache')
    expect(mockDoc).toHaveBeenCalledWith('stories')
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ stories: sampleStories }))
  })
})

describe('getHNStories', () => {
  it('returns cached stories without calling the Algolia API on a hit', async () => {
    mockGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        stories: sampleStories,
        fetchedAt: { toDate: () => new Date() },
      }),
    })
    const result = await getHNStories()
    expect(result).toEqual(sampleStories)
    expect(mockFetchTopStories).not.toHaveBeenCalled()
  })

  it('fetches fresh stories and populates the cache on a miss', async () => {
    mockGet.mockResolvedValueOnce({ exists: false })
    mockFetchTopStories.mockResolvedValueOnce(sampleStories)
    const result = await getHNStories()
    expect(mockFetchTopStories).toHaveBeenCalled()
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ stories: sampleStories }))
    expect(result).toEqual(sampleStories)
  })
})
