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
  return items
    .filter((item): item is Required<RssItem> => Boolean(item.title && item.link && item.pubDate))
    .map((item) => ({
      title: item.title,
      url: item.link,
      publishedAt: new Date(item.pubDate).toISOString(),
    }))
}
