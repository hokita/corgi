# Anthropic News Briefing Design

**Date:** 2026-07-27
**Status:** Approved

## Overview

A new tool lets the assistant fetch Anthropic's latest official news/blog posts (`anthropic.com/news` — covers Claude, Claude Code, and other Anthropic announcements) and render them as a briefing, the same way `get_hacker_news_briefing` already does for Hacker News. It is a fully independent feature: its own tool, its own frontend button, its own cache — nothing about the existing HN briefing is touched.

Anthropic does not publish an official RSS feed for `anthropic.com/news`. The page is a client-rendered Next.js app, so a plain `fetch()` of the HTML would not see the article list. Instead we use the unofficial RSS mirror `https://openrss.org/feed/www.anthropic.com/news`, confirmed working (valid RSS 2.0, current items) during design. This is a real trade-off: the feature depends on a free third-party service staying up. If it disappears, the tool starts failing (surfaced to the user as a normal tool error, see Error Handling) until someone notices and either finds a replacement mirror or builds a scraper.

## Data Layer

### `backend/src/tools/anthropicNews.ts` (new)

```ts
export interface AnthropicNewsPost {
  title: string
  url: string
  publishedAt: string // ISO date string
}

export async function fetchAnthropicNews(): Promise<AnthropicNewsPost[]>
```

Fetches `https://openrss.org/feed/www.anthropic.com/news`, parses the RSS XML with `fast-xml-parser` (new dependency — zero-dependency, widely used; avoids fragile hand-rolled regex parsing of XML/CDATA/entities), and maps each `<item>` (`title`, `link`, `pubDate`) to an `AnthropicNewsPost`. `pubDate` is converted to an ISO string via `new Date(pubDate).toISOString()`. Throws if the HTTP response is not OK (mirrors `fetchTopStories`'s `throw new Error(...status)` pattern).

### `backend/src/services/anthropicNewsCache.ts` (new)

Mirrors `hnCache.ts` exactly, with two differences: a 24h TTL (vs. HN's 6h) since Anthropic posts far less often, and a separate Firestore collection so the two caches never collide.

```ts
const TTL_MS = 24 * 60 * 60 * 1000
const CACHE_COLLECTION = 'anthropic_news_cache'
const CACHE_DOC_ID = 'posts'

export async function getCachedPosts(): Promise<AnthropicNewsPost[] | null>
export async function setCachedPosts(posts: AnthropicNewsPost[]): Promise<void>
export async function getAnthropicNews(): Promise<AnthropicNewsPost[]>
```

## Prompt

### `backend/src/prompts/anthropicNews.ts` (new)

```ts
export const ANTHROPIC_NEWS_BRIEFING_PROMPT = `...`
```

Unlike the HN prompt (which scores/filters by points and buckets into categories), Anthropic posts are just a chronological list — no scoring signal exists. Format:

```
# 🤖 From Anthropic
*Latest news & updates*

- **[{title}]({url})** — {date}
  {One sentence on what it is and why it matters.}
```

Instructs the model to show up to the 10 most recent posts, most recent first, one-sentence blurb per post, and (matching the HN prompt's guardrail) not to invent details not implied by the title.

## Tool Registration

### `backend/src/tools/registry.ts`

Add one entry to `toolDefinitions`, following the existing `get_hacker_news_briefing` shape exactly:

```ts
{
  declaration: {
    name: 'get_anthropic_news_briefing',
    description:
      'Fetch the latest posts from Anthropic\'s official news page and render a briefing. Call when the user asks for Claude Code updates, Anthropic news, or what\'s new from Anthropic/Claude.',
    parameters: { type: SchemaType.OBJECT, properties: {}, required: [] },
  },
  execute: async (ctx) => {
    ctx.emitProgress('Fetching Anthropic news...')
    const posts = await getAnthropicNews()
    return { posts, format_instructions: ANTHROPIC_NEWS_BRIEFING_PROMPT }
  },
},
```

No changes to `createFunctionExecutor` — its existing try/catch already turns a thrown error (bad HTTP status, parse failure) into `{ error: message }` for any tool, so no new error handling is needed.

## Frontend

### `frontend/src/components/ClaudeCodeNewsButton.tsx` (new)

Copy of `MorningBriefingButton.tsx`: same props (`onSend`, `disabled`), same button styling. Sends `"What's new from Anthropic and Claude Code?"` instead of the HN prompt, uses `faNewspaper` instead of `faMugHot`, and labels itself "Claude Code News".

### `frontend/src/pages/ChatPage.tsx`

Render `<ClaudeCodeNewsButton onSend={handleSend} disabled={sending} />` next to the existing `<MorningBriefingButton />` in the empty-state row (`messages.length === 0 && !sending`).

## Data Flow

```
User clicks "Claude Code News" button (or asks in chat)
  → handleSend("What's new from Anthropic and Claude Code?")
  → Gemini selects get_anthropic_news_briefing tool
  → Backend: emit progress "Fetching Anthropic news..."
  → getAnthropicNews()
      → cache hit (< 24h old): return cached posts
      → cache miss: fetchAnthropicNews() → parse RSS → cache in Firestore → return posts
  → Backend returns { posts, format_instructions } to Gemini
  → Gemini renders the "From Anthropic" Markdown briefing as its reply
```

## Testing

TDD (red → green), matching existing coverage depth for the HN feature:

- `anthropicNews.test.ts` — maps RSS items to `AnthropicNewsPost[]`, handles missing/malformed fields, throws on non-OK HTTP status. Mirrors `hackernews.test.ts`.
- `anthropicNewsCache.test.ts` — cache hit/miss/stale behavior. Mirrors `hnCache.test.ts`.

No test is added for the `registry.ts` wiring or the `ClaudeCodeNewsButton` component, matching current precedent: neither exists today for `get_hacker_news_briefing` or `MorningBriefingButton`.

## What Is Not In Scope

- Filtering posts to only ones that mention "Claude Code" specifically — the source answer was "Anthropic's official blog broadly," so all news posts are included.
- A fallback source if the openrss.org mirror goes down.
- Deduplicating posts already seen in a previous briefing ("what's new since last time") — like the HN briefing, this always shows a fresh snapshot of the latest posts.
