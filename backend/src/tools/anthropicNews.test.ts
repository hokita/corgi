import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchAnthropicNews } from './anthropicNews'

const mockFetch = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', mockFetch)
})

function makeFeed(itemsXml: string) {
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>Newsroom</title>${itemsXml}</channel></rss>`
}

describe('fetchAnthropicNews', () => {
  it('maps RSS items to AnthropicNewsPost shape', async () => {
    const xml = makeFeed(
      '<item><title><![CDATA[Introducing Claude Opus 5]]></title><link><![CDATA[https://www.anthropic.com/news/claude-opus-5]]></link><pubDate>Fri, 24 Jul 2026 04:00:00 GMT</pubDate></item>'
    )
    mockFetch.mockResolvedValueOnce({ ok: true, text: async () => xml })
    const posts = await fetchAnthropicNews()
    expect(posts).toEqual([
      {
        title: 'Introducing Claude Opus 5',
        url: 'https://www.anthropic.com/news/claude-opus-5',
        publishedAt: '2026-07-24T04:00:00.000Z',
      },
    ])
  })

  it('handles a single item without wrapping it in an array (fast-xml-parser quirk)', async () => {
    const xml = makeFeed(
      '<item><title><![CDATA[Only Post]]></title><link><![CDATA[https://www.anthropic.com/news/only-post]]></link><pubDate>Mon, 01 Jun 2026 00:00:00 GMT</pubDate></item>'
    )
    mockFetch.mockResolvedValueOnce({ ok: true, text: async () => xml })
    const posts = await fetchAnthropicNews()
    expect(posts).toHaveLength(1)
    expect(posts[0].title).toBe('Only Post')
  })

  it('filters out items missing a title, link, or pubDate', async () => {
    const xml = makeFeed(
      '<item><link><![CDATA[https://www.anthropic.com/news/no-title]]></link><pubDate>Mon, 01 Jun 2026 00:00:00 GMT</pubDate></item>' +
        '<item><title><![CDATA[Has Everything]]></title><link><![CDATA[https://www.anthropic.com/news/has-everything]]></link><pubDate>Tue, 02 Jun 2026 00:00:00 GMT</pubDate></item>'
    )
    mockFetch.mockResolvedValueOnce({ ok: true, text: async () => xml })
    const posts = await fetchAnthropicNews()
    expect(posts).toHaveLength(1)
    expect(posts[0].title).toBe('Has Everything')
  })

  it('returns an empty array when the feed has no items', async () => {
    const xml = makeFeed('')
    mockFetch.mockResolvedValueOnce({ ok: true, text: async () => xml })
    const posts = await fetchAnthropicNews()
    expect(posts).toEqual([])
  })

  it('skips items with an unparseable pubDate instead of throwing', async () => {
    const xml = makeFeed(
      '<item><title><![CDATA[Bad Date Post]]></title><link><![CDATA[https://www.anthropic.com/news/bad-date]]></link><pubDate>not a date</pubDate></item>' +
        '<item><title><![CDATA[Good Post]]></title><link><![CDATA[https://www.anthropic.com/news/good]]></link><pubDate>Tue, 02 Jun 2026 00:00:00 GMT</pubDate></item>'
    )
    mockFetch.mockResolvedValueOnce({ ok: true, text: async () => xml })
    const posts = await fetchAnthropicNews()
    expect(posts).toHaveLength(1)
    expect(posts[0].title).toBe('Good Post')
  })

  it('returns posts sorted by publishedAt descending, regardless of feed order', async () => {
    const xml = makeFeed(
      '<item><title><![CDATA[Older Post]]></title><link><![CDATA[https://www.anthropic.com/news/older]]></link><pubDate>Mon, 01 Jun 2026 00:00:00 GMT</pubDate></item>' +
        '<item><title><![CDATA[Newest Post]]></title><link><![CDATA[https://www.anthropic.com/news/newest]]></link><pubDate>Fri, 24 Jul 2026 04:00:00 GMT</pubDate></item>' +
        '<item><title><![CDATA[Middle Post]]></title><link><![CDATA[https://www.anthropic.com/news/middle]]></link><pubDate>Tue, 09 Jun 2026 00:00:00 GMT</pubDate></item>'
    )
    mockFetch.mockResolvedValueOnce({ ok: true, text: async () => xml })
    const posts = await fetchAnthropicNews()
    expect(posts.map((p) => p.title)).toEqual(['Newest Post', 'Middle Post', 'Older Post'])
  })

  it('throws when the feed responds with a non-OK status', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 })
    await expect(fetchAnthropicNews()).rejects.toThrow(
      'Anthropic news RSS feed responded with 500'
    )
  })
})
