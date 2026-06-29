import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchTopStories } from './hackernews'

const mockFetch = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', mockFetch)
})

function makeHit(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    objectID: '1',
    title: 'A great story',
    url: 'https://example.com/a',
    points: 150,
    num_comments: 42,
    _tags: ['story', 'front_page'],
    ...overrides,
  }
}

describe('fetchTopStories', () => {
  it('maps Algolia hits to token-efficient HNStory shape', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ hits: [makeHit()] }),
    })
    const stories = await fetchTopStories()
    expect(stories).toEqual([
      { id: '1', title: 'A great story', url: 'https://example.com/a', points: 150, comments: 42 },
    ])
  })

  it('filters out job and poll posts', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        hits: [
          makeHit({ objectID: 'job1', _tags: ['job'] }),
          makeHit({ objectID: 'poll1', _tags: ['poll', 'front_page'] }),
          makeHit({ objectID: 'story1' }),
        ],
      }),
    })
    const stories = await fetchTopStories()
    expect(stories).toHaveLength(1)
    expect(stories[0].id).toBe('story1')
  })

  it('defaults missing points/comments to 0', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ hits: [makeHit({ points: null, num_comments: null })] }),
    })
    const stories = await fetchTopStories()
    expect(stories[0].points).toBe(0)
    expect(stories[0].comments).toBe(0)
  })

  it('throws when the API responds with a non-OK status', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 })
    await expect(fetchTopStories()).rejects.toThrow('Algolia HN API responded with 500')
  })
})
