# Anthropic News Briefing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `get_anthropic_news_briefing` tool that fetches Anthropic's latest official news posts and renders them as a briefing, triggered by a new standalone frontend button, fully independent of the existing Hacker News briefing.

**Architecture:** Mirrors the existing Hacker News briefing feature end to end: a fetch function (`tools/anthropicNews.ts`) pulls and parses an RSS feed, a Firestore-backed cache service (`services/anthropicNewsCache.ts`) wraps it with a TTL, a prompt (`prompts/anthropicNews.ts`) tells the model how to format the result, and a new entry in `tools/registry.ts` wires it up as a Gemini function-calling tool. A new frontend button sends a canned prompt into chat to trigger it, next to the existing `MorningBriefingButton`.

**Tech Stack:** Node.js/TypeScript backend (Express, Firestore, Gemini function calling), React/TypeScript frontend, Vitest for tests. New dependency: `fast-xml-parser` (backend only).

## Global Constraints

- Source URL: `https://openrss.org/feed/www.anthropic.com/news` (unofficial RSS mirror — Anthropic publishes no official feed; verified working during design).
- Cache TTL: 24 hours (vs. HN's 6 hours), separate Firestore collection `anthropic_news_cache`, doc id `posts`.
- Prompt shows up to the 10 most recent posts, most recent first, one-sentence blurb per post, and must not invent details not implied by the title (same guardrail as the HN prompt).
- No filtering to "Claude Code only" posts — all Anthropic news posts are in scope.
- No new test files for `registry.ts` wiring or the new button component — matches existing precedent (neither exists for `get_hacker_news_briefing` / `MorningBriefingButton`).
- All backend tests run from `backend/`: `npx vitest run <path>` (or `npm test` for all).
- All frontend tests run from `frontend/`: `npx vitest run <path>` (or `npm test` for all).
- Design doc: `docs/superpowers/specs/2026-07-27-anthropic-news-briefing-design.md`.

---

### Task 1: Add `fast-xml-parser` dependency

**Files:**
- Modify: `backend/package.json`

**Interfaces:**
- Produces: `fast-xml-parser` package available for import in `backend/src/**`.

- [ ] **Step 1: Add the dependency to `backend/package.json`**

In the `"dependencies"` block, insert `fast-xml-parser` alphabetically between `"express"` and `"firebase-admin"`:

```json
  "dependencies": {
    "@google/generative-ai": "^0.24.1",
    "@langfuse/otel": "^5.9.1",
    "@langfuse/tracing": "^5.9.1",
    "@opentelemetry/sdk-trace-node": "^2.9.0",
    "cors": "^2.8.5",
    "express": "^4.18.0",
    "fast-xml-parser": "^5.10.1",
    "firebase-admin": "^12.0.0"
  },
```

- [ ] **Step 2: Install**

Run: `cd backend && npm install`
Expected: `fast-xml-parser` and its lockfile entry are added; no errors.

- [ ] **Step 3: Commit**

```bash
git add backend/package.json backend/package-lock.json
git commit -m "chore: add fast-xml-parser dependency for RSS parsing"
```

---

### Task 2: `tools/anthropicNews.ts` — fetch and parse the RSS feed

**Files:**
- Create: `backend/src/tools/anthropicNews.ts`
- Test: `backend/src/tools/anthropicNews.test.ts`

**Interfaces:**
- Consumes: global `fetch`, `XMLParser` from `fast-xml-parser` (installed in Task 1).
- Produces:
  ```ts
  export interface AnthropicNewsPost {
    title: string
    url: string
    publishedAt: string // ISO date string
  }
  export async function fetchAnthropicNews(): Promise<AnthropicNewsPost[]>
  ```
  Task 3 imports `fetchAnthropicNews` and `AnthropicNewsPost` from this file.

- [ ] **Step 1: Write the failing tests**

Create `backend/src/tools/anthropicNews.test.ts`:

```ts
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

  it('throws when the feed responds with a non-OK status', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 })
    await expect(fetchAnthropicNews()).rejects.toThrow(
      'Anthropic news RSS feed responded with 500'
    )
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx vitest run src/tools/anthropicNews.test.ts`
Expected: FAIL — `anthropicNews.ts` does not exist yet (`Cannot find module './anthropicNews'`).

- [ ] **Step 3: Write the implementation**

Create `backend/src/tools/anthropicNews.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run src/tools/anthropicNews.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/tools/anthropicNews.ts backend/src/tools/anthropicNews.test.ts
git commit -m "feat: add fetchAnthropicNews to pull Anthropic's RSS news feed"
```

---

### Task 3: `services/anthropicNewsCache.ts` — Firestore TTL cache

**Files:**
- Create: `backend/src/services/anthropicNewsCache.ts`
- Test: `backend/src/services/anthropicNewsCache.test.ts`

**Interfaces:**
- Consumes: `fetchAnthropicNews`, `AnthropicNewsPost` from `../tools/anthropicNews` (Task 2); `getFirestore`, `Timestamp` from `firebase-admin/firestore`.
- Produces:
  ```ts
  export async function getCachedPosts(): Promise<AnthropicNewsPost[] | null>
  export async function setCachedPosts(posts: AnthropicNewsPost[]): Promise<void>
  export async function getAnthropicNews(): Promise<AnthropicNewsPost[]>
  ```
  Task 5 imports `getAnthropicNews` from this file.

- [ ] **Step 1: Write the failing tests**

Create `backend/src/services/anthropicNewsCache.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx vitest run src/services/anthropicNewsCache.test.ts`
Expected: FAIL — `anthropicNewsCache.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `backend/src/services/anthropicNewsCache.ts`:

```ts
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { fetchAnthropicNews, type AnthropicNewsPost } from '../tools/anthropicNews'

const TTL_MS = 24 * 60 * 60 * 1000
const CACHE_COLLECTION = 'anthropic_news_cache'
const CACHE_DOC_ID = 'posts'

export async function getCachedPosts(): Promise<AnthropicNewsPost[] | null> {
  const db = getFirestore()
  const doc = await db.collection(CACHE_COLLECTION).doc(CACHE_DOC_ID).get()
  if (!doc.exists) return null
  const data = doc.data()!
  const fetchedAt = (data.fetchedAt as Timestamp).toDate()
  if (Date.now() - fetchedAt.getTime() > TTL_MS) return null
  return data.posts as AnthropicNewsPost[]
}

export async function setCachedPosts(posts: AnthropicNewsPost[]): Promise<void> {
  const db = getFirestore()
  await db.collection(CACHE_COLLECTION).doc(CACHE_DOC_ID).set({
    posts,
    fetchedAt: Timestamp.now(),
  })
}

export async function getAnthropicNews(): Promise<AnthropicNewsPost[]> {
  const cached = await getCachedPosts()
  if (cached) return cached
  const posts = await fetchAnthropicNews()
  await setCachedPosts(posts)
  return posts
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run src/services/anthropicNewsCache.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/anthropicNewsCache.ts backend/src/services/anthropicNewsCache.test.ts
git commit -m "feat: add 24h Firestore cache for Anthropic news posts"
```

---

### Task 4: `prompts/anthropicNews.ts` — briefing format instructions

**Files:**
- Create: `backend/src/prompts/anthropicNews.ts`

**Interfaces:**
- Produces: `export const ANTHROPIC_NEWS_BRIEFING_PROMPT: string`. Task 5 imports this.

No test for this file — it's a plain string constant, same as `prompts/hackernews.ts` (which also has no test file).

- [ ] **Step 1: Write the file**

Create `backend/src/prompts/anthropicNews.ts`:

```ts
export const ANTHROPIC_NEWS_BRIEFING_PROMPT = `You have received Anthropic's latest official news posts (posts array: title, url, publishedAt). Produce a "From Anthropic" briefing — a concise, scannable Markdown digest.

SCOPE:
- Show up to the 10 most recent posts, most recent first (posts are already provided in feed order — do not re-sort).
- If there are fewer than 10, show all of them.

OUTPUT FORMAT (Markdown):

# 🤖 From Anthropic
*Latest news & updates*

- **[{title}]({url})** — {publishedAt formatted as a human-readable date, e.g. Jul 24, 2026}
  {One sentence on what it is and why it matters to someone who uses Claude or Claude Code.}

(repeat for each post)

Keep the per-post summary to one sentence. Do not invent details not implied by the title — if unsure, describe it generically.`
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/prompts/anthropicNews.ts
git commit -m "feat: add Anthropic news briefing prompt"
```

---

### Task 5: Wire the tool into `tools/registry.ts`

**Files:**
- Modify: `backend/src/tools/registry.ts`

**Interfaces:**
- Consumes: `getAnthropicNews` from `../services/anthropicNewsCache` (Task 3), `ANTHROPIC_NEWS_BRIEFING_PROMPT` from `../prompts/anthropicNews` (Task 4).
- Produces: `get_anthropic_news_briefing` function declaration, discoverable by Gemini alongside the other tools in `chatFunctionDeclarations`.

No new test file — `registry.ts` has no existing test file, matching current precedent for `get_hacker_news_briefing`.

- [ ] **Step 1: Add the imports**

In `backend/src/tools/registry.ts`, after the existing `import { HN_BRIEFING_PROMPT } from '../prompts/hackernews'` line, add:

```ts
import { getAnthropicNews } from '../services/anthropicNewsCache'
import { ANTHROPIC_NEWS_BRIEFING_PROMPT } from '../prompts/anthropicNews'
```

- [ ] **Step 2: Add the new tool definition**

In `backend/src/tools/registry.ts`, inside the `toolDefinitions` array, add a new entry immediately after the `get_hacker_news_briefing` entry (i.e. right before the closing `]` of `toolDefinitions`):

```ts
  {
    declaration: {
      name: 'get_anthropic_news_briefing',
      description:
        "Fetch the latest posts from Anthropic's official news page and render a briefing. Call when the user asks for Claude Code updates, Anthropic news, or what's new from Anthropic/Claude.",
      parameters: {
        type: SchemaType.OBJECT,
        properties: {},
        required: [],
      },
    },
    execute: async (ctx) => {
      ctx.emitProgress('Fetching Anthropic news...')
      const posts = await getAnthropicNews()
      return { posts, format_instructions: ANTHROPIC_NEWS_BRIEFING_PROMPT }
    },
  },
```

- [ ] **Step 3: Type-check and run the full backend test suite**

Run: `cd backend && npx tsc --noEmit && npm test`
Expected: no type errors; all backend tests pass (existing suite + Tasks 2–3's new tests).

- [ ] **Step 4: Commit**

```bash
git add backend/src/tools/registry.ts
git commit -m "feat: register get_anthropic_news_briefing tool"
```

---

### Task 6: `ClaudeCodeNewsButton` frontend component

**Files:**
- Create: `frontend/src/components/ClaudeCodeNewsButton.tsx`

**Interfaces:**
- Consumes: `onSend: (text: string) => void`, `disabled: boolean` props (same shape as `MorningBriefingButton`).
- Produces: default-exported `ClaudeCodeNewsButton` component. Task 7 imports and renders it.

No test file — matches current precedent: `MorningBriefingButton.tsx` has no test file either.

- [ ] **Step 1: Write the component**

Create `frontend/src/components/ClaudeCodeNewsButton.tsx`:

```tsx
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faNewspaper } from '@fortawesome/free-solid-svg-icons'

interface Props {
  onSend: (text: string) => void
  disabled: boolean
}

export default function ClaudeCodeNewsButton({ onSend, disabled }: Props) {
  return (
    <button
      onClick={() => !disabled && onSend("What's new from Anthropic and Claude Code?")}
      disabled={disabled}
      className="px-4 py-2 rounded-full text-sm border border-[#0084ff] text-[#0084ff] bg-transparent hover:bg-blue-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
    >
      <FontAwesomeIcon icon={faNewspaper} className="mr-1" /> Claude Code News
    </button>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ClaudeCodeNewsButton.tsx
git commit -m "feat: add ClaudeCodeNewsButton component"
```

---

### Task 7: Render the button in `ChatPage.tsx`

**Files:**
- Modify: `frontend/src/pages/ChatPage.tsx`

**Interfaces:**
- Consumes: `ClaudeCodeNewsButton` from `../components/ClaudeCodeNewsButton` (Task 6); existing `handleSend`, `sending` already defined in `ChatPage.tsx`.

- [ ] **Step 1: Add the import**

In `frontend/src/pages/ChatPage.tsx`, after line 9 (`import MorningBriefingButton from '../components/MorningBriefingButton'`), add:

```tsx
import ClaudeCodeNewsButton from '../components/ClaudeCodeNewsButton'
```

- [ ] **Step 2: Render the button next to `MorningBriefingButton`**

Find this block (around line 110–114):

```tsx
      {messages.length === 0 && !sending ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-gray-400">
          Start a conversation
          <MorningBriefingButton onSend={handleSend} disabled={sending} />
        </div>
      ) : (
```

Replace it with:

```tsx
      {messages.length === 0 && !sending ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-gray-400">
          Start a conversation
          <div className="flex gap-2">
            <MorningBriefingButton onSend={handleSend} disabled={sending} />
            <ClaudeCodeNewsButton onSend={handleSend} disabled={sending} />
          </div>
        </div>
      ) : (
```

- [ ] **Step 3: Type-check and run the full frontend test suite**

Run: `cd frontend && npx tsc --noEmit && npm test`
Expected: no type errors; all existing frontend tests still pass (no test asserts on the exact empty-state DOM structure removed here — verify by reading `ChatPage`-related test output for failures).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/ChatPage.tsx
git commit -m "feat: render Claude Code News button in chat empty state"
```

---

### Task 8: Manual end-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Run full backend and frontend suites, lint, and build**

Run:
```bash
cd backend && npm test && npx eslint src && npx tsc --noEmit
cd ../frontend && npm test && npx eslint src && npx tsc --noEmit
```
Expected: everything passes clean.

- [ ] **Step 2: Manually exercise the feature**

Start both dev servers (`cd backend && npm run dev`, `cd frontend && npm run dev` in separate terminals), sign in, click the new "Claude Code News" button on the empty chat screen, and confirm:
- A "Fetching Anthropic news..." progress step appears.
- The model's reply is a "🤖 From Anthropic" Markdown list with real post titles/links/dates.
- Clicking it again shortly after returns the same list quickly (cache hit — check backend logs / Firestore `anthropic_news_cache/posts` doc for `fetchedAt`).

- [ ] **Step 3: Commit any fixes found during manual verification**

If manual testing surfaces a bug, fix it, re-run the relevant test(s), and commit with a message describing the fix. If no issues, no commit is needed for this task.

---

## What Is Not In Scope

(carried over from the design doc)

- Filtering posts to only ones that mention "Claude Code" specifically.
- A fallback source if the openrss.org mirror goes down.
- Deduplicating posts already seen in a previous briefing.
