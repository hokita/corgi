import { XMLParser } from 'fast-xml-parser'

export interface AnthropicNewsPost {
  title: string
  url: string
  publishedAt: string
}

interface RssItem {
  title?: string
  link?: string
  pubDate?: string
}

interface RssFeed {
  rss?: {
    channel?: {
      item?: RssItem | RssItem[]
    }
  }
}

const ANTHROPIC_NEWS_RSS_URL = 'https://openrss.org/feed/www.anthropic.com/news'

function parsePublishedAt(pubDate: string): string | null {
  const date = new Date(pubDate)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export async function fetchAnthropicNews(): Promise<AnthropicNewsPost[]> {
  const res = await fetch(ANTHROPIC_NEWS_RSS_URL)
  if (!res.ok) {
    throw new Error(`Anthropic news RSS feed responded with ${res.status}`)
  }
  const xml = await res.text()
  const parser = new XMLParser()
  const feed = parser.parse(xml) as RssFeed
  const rawItems = feed.rss?.channel?.item
  const items = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : []
  const posts: AnthropicNewsPost[] = []
  for (const item of items) {
    if (!item.title || !item.link || !item.pubDate) continue
    const publishedAt = parsePublishedAt(item.pubDate)
    if (!publishedAt) continue
    posts.push({ title: item.title, url: item.link, publishedAt })
  }
  return posts.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
}
