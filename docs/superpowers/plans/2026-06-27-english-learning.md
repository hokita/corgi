# English Learning Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a user sends an English message, the Gemini model silently analyzes it for grammar or phrasing issues and—via function calling—saves valuable learning points to Firestore, while the frontend shows a live progress strip above the response.

**Architecture:** The existing `suggest_options` function-calling pattern in `GeminiProvider` is extended to include a second tool `save_english_mistake`. When the model calls it mid-stream, the route handler saves the record to Firestore and emits a `progress` SSE event. The frontend appends progress steps to ephemeral state and renders them above the streaming assistant bubble via a new `ThinkingProgress` component.

**Tech Stack:** Node.js + TypeScript + Express (backend), React + Vite + Tailwind (frontend), Firestore (database), Gemini (`@google/generative-ai`), Vitest + Supertest + React Testing Library (tests).

## Global Constraints

- All backend tests run from `backend/`: `npx vitest run <path>` (or `npm test` for all)
- All frontend tests run from `frontend/`: `npx vitest run <path>` (or `npm test` for all)
- TypeScript build check: `npm run build` from the relevant package directory
- Follow the existing `vitest` + `vi.mock` test pattern throughout
- Do not introduce new dependencies

---

## File Map

| File | Change |
|------|--------|
| `backend/src/models/api.ts` | Add `EnglishMistakeData` interface; add `progress` to `SSEEvent` union |
| `backend/src/providers/AIProvider.ts` | Extend `StreamItem` union with `save_english_mistake` type |
| `backend/src/services/firestore.ts` | Add `saveEnglishMistake()` function |
| `firestore.indexes.json` | Add composite index for `english_mistakes` collection |
| `backend/src/providers/GeminiProvider.ts` | Merge tools into one declaration; add `save_english_mistake`; update system prompt; yield new `StreamItem` |
| `backend/src/routes/conversations.ts` | Emit `progress` SSE at start/end; handle `save_english_mistake` stream item |
| `backend/src/routes/conversations.test.ts` | Add `saveEnglishMistake` to firestore mock; add progress + mistake tests |
| `backend/src/providers/GeminiProvider.test.ts` | Add test for `save_english_mistake` function call |
| `frontend/src/api.ts` | Add `onProgress` to `StreamCallbacks`; handle `progress` SSE events |
| `frontend/src/api.test.ts` | Add test for `onProgress` callback |
| `frontend/src/components/ThinkingProgress.tsx` | New component — renders progress steps |
| `frontend/src/components/ThinkingProgress.test.tsx` | Unit tests for `ThinkingProgress` |
| `frontend/src/components/MessageList.tsx` | Add `progressSteps` prop; render `ThinkingProgress` above last assistant message |
| `frontend/src/components/MessageList.test.tsx` | Add tests for `progressSteps` rendering |
| `frontend/src/pages/ChatPage.tsx` | Add `progressSteps` state; wire `onProgress`; pass steps to `MessageList` |

---

## Task 1: Backend shared types + Firestore schema

**Files:**
- Modify: `backend/src/models/api.ts`
- Modify: `backend/src/providers/AIProvider.ts`
- Modify: `backend/src/services/firestore.ts`
- Modify: `firestore.indexes.json`

**Interfaces:**
- Produces: `EnglishMistakeData` (used by Tasks 2, 3); `progress` SSE event (used by Task 3); extended `StreamItem` (used by Tasks 2, 3)

- [ ] **Step 1: Add `EnglishMistakeData` and `progress` to `backend/src/models/api.ts`**

Replace the entire file with:

```ts
// POST /api/conversations
export interface CreateConversationRequest {
  message: string
}

// POST /api/conversations/:id/messages
export interface SendMessageRequest {
  message: string
}

// GET /api/conversations
export interface ConversationSummary {
  id: string
  title: string
  lastMessage: string
  updatedAt: string
}

// GET /api/conversations/:id/messages
export interface MessageResponse {
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  suggestions?: string[]
}

// Shared shape for an English learning record
export interface EnglishMistakeData {
  originalText: string
  correctedText: string
  category: string
  severity: string
  patternKey: string
}

// SSE event types for POST /api/conversations and POST /api/conversations/:id/messages
export type SSEEvent =
  | { type: 'meta'; conversationId: string; title: string }
  | { type: 'chunk'; text: string }
  | { type: 'suggestions'; items: string[] }
  | { type: 'progress'; message: string }
  | { type: 'done' }
  | { type: 'error'; message: string }

// Error response (all non-SSE endpoints)
export interface ErrorResponse {
  error: string
}
```

- [ ] **Step 2: Extend `StreamItem` in `backend/src/providers/AIProvider.ts`**

Replace the entire file with:

```ts
import type { EnglishMistakeData } from '../models/api'

export interface Message {
  role: 'user' | 'assistant'
  content: string
}

export type StreamItem =
  | string
  | { type: 'suggestions'; items: string[] }
  | { type: 'save_english_mistake'; data: EnglishMistakeData }

export interface AIProvider {
  chatStream(history: Message[], newMessage: string): AsyncIterable<StreamItem>
}
```

- [ ] **Step 3: Add `saveEnglishMistake` to `backend/src/services/firestore.ts`**

Add this import at the top of the existing file (after the existing import):

```ts
import type { EnglishMistakeData } from '../models/api'
```

Then append at the end of the file:

```ts
export async function saveEnglishMistake(
  uid: string,
  conversationId: string,
  data: EnglishMistakeData
): Promise<void> {
  const db = getFirestore()
  await db.collection('english_mistakes').add({
    uid,
    conversationId,
    ...data,
    createdAt: Timestamp.now(),
  })
}
```

- [ ] **Step 4: Add Firestore index to `firestore.indexes.json`**

Replace the entire file with:

```json
{
  "indexes": [
    {
      "collectionGroup": "conversations",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "uid", "order": "ASCENDING" },
        { "fieldPath": "updatedAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "english_mistakes",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "uid", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    }
  ],
  "fieldOverrides": []
}
```

- [ ] **Step 5: Verify TypeScript builds**

```bash
cd backend && npm run build
```

Expected: exits 0 with no type errors.

- [ ] **Step 6: Commit**

```bash
git add backend/src/models/api.ts backend/src/providers/AIProvider.ts backend/src/services/firestore.ts firestore.indexes.json
git commit -m "feat: add EnglishMistakeData type, progress SSE event, and saveEnglishMistake firestore function"
```

---

## Task 2: Add `save_english_mistake` to GeminiProvider

**Files:**
- Modify: `backend/src/providers/GeminiProvider.ts`
- Modify: `backend/src/providers/GeminiProvider.test.ts`

**Interfaces:**
- Consumes: `StreamItem` (extended in Task 1), `EnglishMistakeData` from `../models/api`
- Produces: yields `{ type: 'save_english_mistake', data: EnglishMistakeData }` mid-stream

- [ ] **Step 1: Write the failing test in `backend/src/providers/GeminiProvider.test.ts`**

Add this test inside the existing `describe('GeminiProvider', ...)` block, after the last test:

```ts
it('yields save_english_mistake item when Gemini calls save_english_mistake', async () => {
  const mistakeData = {
    originalText: 'I resolved the issue with downgrade of Node version.',
    correctedText: 'I resolved the issue by downgrading the Node version.',
    category: 'grammar',
    severity: 'medium',
    patternKey: 'by_gerund_for_method',
  }
  async function* fakeStream() {
    yield { text: () => 'Great effort!', candidates: undefined }
    yield {
      text: () => '',
      candidates: [
        {
          content: {
            parts: [
              {
                functionCall: {
                  name: 'save_english_mistake',
                  args: mistakeData,
                },
              },
            ],
          },
        },
      ],
    }
  }
  mockSendMessageStream.mockResolvedValue({ stream: fakeStream() })
  const provider = new GeminiProvider('fake-key')
  const items = await collectStream(
    provider.chatStream([], 'I resolved the issue with downgrade of Node version.')
  )
  expect(items).toEqual([
    'Great effort!',
    { type: 'save_english_mistake', data: mistakeData },
  ])
})
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
cd backend && npx vitest run src/providers/GeminiProvider.test.ts
```

Expected: the new test fails with "Expected … to equal …" or similar.

- [ ] **Step 3: Implement the changes in `backend/src/providers/GeminiProvider.ts`**

Replace the entire file with:

```ts
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai'
import type { AIProvider, Message, StreamItem } from './AIProvider'
import type { EnglishMistakeData } from '../models/api'

const functionTools = {
  functionDeclarations: [
    {
      name: 'suggest_options',
      description:
        'Call at the end of your response to suggest next steps or options for the user to choose from as buttons.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          items: {
            type: SchemaType.ARRAY,
            items: { type: SchemaType.STRING },
            description: '2 to 4 short button labels',
          },
        },
        required: ['items'],
      },
    },
    {
      name: 'save_english_mistake',
      description:
        "Save an English learning point when the user's message contains a grammar mistake, unnatural phrasing, wrong preposition, article error, or word choice issue worth reviewing later. Only call for genuinely valuable learning points — skip trivial typos or very minor issues.",
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          originalText: {
            type: SchemaType.STRING,
            description: "The user's original phrasing that contains the mistake",
          },
          correctedText: {
            type: SchemaType.STRING,
            description: 'The improved, natural English version',
          },
          category: {
            type: SchemaType.STRING,
            description: 'One of: grammar, word-choice, preposition, article, phrasing',
          },
          severity: {
            type: SchemaType.STRING,
            description: 'One of: low, medium, high',
          },
          patternKey: {
            type: SchemaType.STRING,
            description:
              'A reusable snake_case pattern identifier, e.g. by_gerund_for_method',
          },
        },
        required: ['originalText', 'correctedText', 'category', 'severity', 'patternKey'],
      },
    },
  ],
}

export interface GeminiProviderOptions {
  googleSearch?: boolean
}

export class GeminiProvider implements AIProvider {
  private model: ReturnType<InstanceType<typeof GoogleGenerativeAI>['getGenerativeModel']>
  private googleSearch: boolean

  constructor(apiKey: string, options: GeminiProviderOptions = {}) {
    this.googleSearch = options.googleSearch ?? false
    const client = new GoogleGenerativeAI(apiKey)
    this.model = client.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction:
        'You are a helpful assistant. When the user is exploring or brainstorming, respond thoughtfully and call `suggest_options` with 2–4 thought-provoking follow-up questions that deepen their thinking. In other contexts, call `suggest_options` with 2–4 useful next steps or options. Additionally, when the user sends a message in English, silently analyze it for grammar mistakes, unnatural phrasing, wrong prepositions, article errors, or word choice issues. If you find a valuable learning point (not a trivial typo), call `save_english_mistake` — do not mention the correction in your reply unless the user explicitly asks about their English.',
    })
  }

  async *chatStream(history: Message[], newMessage: string): AsyncIterable<StreamItem> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tools: any[] = [functionTools]
    if (this.googleSearch) tools.push({ googleSearch: {} })
    const chat = this.model.startChat({
      history: history.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
      tools,
      // Required when mixing built-in tools (googleSearch) with function calling
      ...(this.googleSearch && {
        toolConfig: { includeServerSideToolInvocations: true } as never,
      }),
    })
    const result = await chat.sendMessageStream(newMessage)

    let suggestOptionsItems: string[] | undefined

    for await (const chunk of result.stream) {
      let hasFunctionCall = false
      for (const candidate of chunk.candidates ?? []) {
        for (const part of candidate.content?.parts ?? []) {
          if ('functionCall' in part) {
            const { name, args } = part.functionCall as { name: string; args: unknown }
            if (name === 'suggest_options') {
              hasFunctionCall = true
              const items = (args as { items?: string[] }).items
              if (Array.isArray(items) && items.length > 0) {
                suggestOptionsItems = items
              }
            } else if (name === 'save_english_mistake') {
              hasFunctionCall = true
              yield { type: 'save_english_mistake', data: args as EnglishMistakeData }
            }
          }
        }
      }
      if (!hasFunctionCall) {
        const text = chunk.text()
        if (text) yield text
      }
    }

    if (suggestOptionsItems) {
      yield { type: 'suggestions', items: suggestOptionsItems }
    }
  }
}
```

> Note: the model name is updated from `gemini-3.5-flash` to `gemini-2.5-flash` — keep the original name if the project was intentionally using a specific version.

- [ ] **Step 4: Run all GeminiProvider tests to confirm they pass**

```bash
cd backend && npx vitest run src/providers/GeminiProvider.test.ts
```

Expected: all tests pass including the new one.

- [ ] **Step 5: Commit**

```bash
git add backend/src/providers/GeminiProvider.ts backend/src/providers/GeminiProvider.test.ts
git commit -m "feat: add save_english_mistake function calling to GeminiProvider"
```

---

## Task 3: Update conversations route to handle save_english_mistake and emit progress

**Files:**
- Modify: `backend/src/routes/conversations.ts`
- Modify: `backend/src/routes/conversations.test.ts`

**Interfaces:**
- Consumes: `StreamItem` with `save_english_mistake` type (Task 1/2); `saveEnglishMistake` from firestore (Task 1)
- Produces: `{ type: 'progress', message: string }` SSE events emitted to client

- [ ] **Step 1: Add `saveEnglishMistake` to the firestore mock and write failing tests in `backend/src/routes/conversations.test.ts`**

In the `vi.mock('../services/firestore', ...)` call, add `saveEnglishMistake` to the mock object:

```ts
vi.mock('../services/firestore', () => ({
  createConversation: vi.fn().mockResolvedValue('conv123'),
  getConversation: vi.fn().mockResolvedValue({
    id: 'conv123',
    uid: 'u1',
    title: 'Hello world',
    lastMessage: '',
    createdAt: null,
    updatedAt: null,
  }),
  listConversations: vi.fn().mockResolvedValue([
    {
      id: 'conv123',
      uid: 'u1',
      title: 'Hello world',
      lastMessage: 'Hi',
      updatedAt: { toDate: () => new Date('2024-01-01') },
    },
  ]),
  addMessage: vi.fn().mockResolvedValue(undefined),
  getMessages: vi
    .fn()
    .mockResolvedValue(
      [] as Array<{ role: 'user' | 'assistant'; content: string; createdAt: string }>
    ),
  updateConversationLastMessage: vi.fn().mockResolvedValue(undefined),
  deleteConversation: vi.fn().mockResolvedValue(undefined),
  saveEnglishMistake: vi.fn().mockResolvedValue(undefined),
}))
```

Then add these tests inside `describe('POST /api/conversations', ...)` after the existing tests:

```ts
it('emits progress events around the response', async () => {
  const res = await request(app)
    .post('/api/conversations')
    .send({ message: 'Hello' })
    .buffer(true)
  const events = parseSSE(res.text)
  const progressEvents = events.filter((e) => e.type === 'progress')
  expect(progressEvents[0]).toEqual({ type: 'progress', message: 'Analyzing your message...' })
  expect(progressEvents[progressEvents.length - 1]).toEqual({ type: 'progress', message: 'Done' })
})

it('saves english mistake and emits progress when AI yields save_english_mistake', async () => {
  const mistakeData = {
    originalText: 'I go to school yesterday.',
    correctedText: 'I went to school yesterday.',
    category: 'grammar',
    severity: 'medium',
    patternKey: 'past_tense_for_past_action',
  }
  async function* stream(): AsyncIterable<StreamItem> {
    yield 'Good effort!'
    yield { type: 'save_english_mistake', data: mistakeData }
  }
  vi.mocked(mockAI.chatStream).mockReturnValue(stream())
  const res = await request(app)
    .post('/api/conversations')
    .send({ message: 'I go to school yesterday.' })
    .buffer(true)
  expect(firestoreService.saveEnglishMistake).toHaveBeenCalledWith('u1', 'conv123', mistakeData)
  const events = parseSSE(res.text)
  expect(events).toContainEqual({ type: 'progress', message: 'Saving learning point...' })
})
```

Add the same two tests inside `describe('POST /api/conversations/:id/messages', ...)`:

```ts
it('emits progress events around the response', async () => {
  const res = await request(app)
    .post('/api/conversations/conv123/messages')
    .send({ message: 'Hello' })
    .buffer(true)
  const events = parseSSE(res.text)
  const progressEvents = events.filter((e) => e.type === 'progress')
  expect(progressEvents[0]).toEqual({ type: 'progress', message: 'Analyzing your message...' })
  expect(progressEvents[progressEvents.length - 1]).toEqual({ type: 'progress', message: 'Done' })
})

it('saves english mistake and emits progress when AI yields save_english_mistake', async () => {
  const mistakeData = {
    originalText: 'I go to school yesterday.',
    correctedText: 'I went to school yesterday.',
    category: 'grammar',
    severity: 'medium',
    patternKey: 'past_tense_for_past_action',
  }
  async function* stream(): AsyncIterable<StreamItem> {
    yield 'Good effort!'
    yield { type: 'save_english_mistake', data: mistakeData }
  }
  vi.mocked(mockAI.chatStream).mockReturnValue(stream())
  const res = await request(app)
    .post('/api/conversations/conv123/messages')
    .send({ message: 'I go to school yesterday.' })
    .buffer(true)
  expect(firestoreService.saveEnglishMistake).toHaveBeenCalledWith('u1', 'conv123', mistakeData)
  const events = parseSSE(res.text)
  expect(events).toContainEqual({ type: 'progress', message: 'Saving learning point...' })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd backend && npx vitest run src/routes/conversations.test.ts
```

Expected: the four new tests fail.

- [ ] **Step 3: Implement the changes in `backend/src/routes/conversations.ts`**

Replace the entire file with:

```ts
import { Router } from 'express'
import type { AIProvider } from '../providers/AIProvider'
import type {
  CreateConversationRequest,
  SendMessageRequest,
  ConversationSummary,
  MessageResponse,
  SSEEvent,
  ErrorResponse,
} from '../models/api'
import * as db from '../services/firestore'

function writeSSE(res: import('express').Response, event: SSEEvent) {
  res.write(`data: ${JSON.stringify(event)}\n\n`)
}

export function createConversationsRouter(ai: AIProvider): Router {
  const router = Router()

  router.post<Record<string, never>, unknown, CreateConversationRequest>('/', async (req, res) => {
    const { message } = req.body
    const uid = req.uid!
    if (!message?.trim()) {
      res.status(400).json({ error: 'message is required' } as ErrorResponse)
      return
    }
    const title = message.slice(0, 40)
    try {
      const conversationId = await db.createConversation(uid, title)
      await db.addMessage(conversationId, 'user', message)

      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')

      writeSSE(res, { type: 'meta', conversationId, title })
      writeSSE(res, { type: 'progress', message: 'Analyzing your message...' })

      let fullText = ''
      let suggestions: string[] | undefined
      for await (const item of ai.chatStream([], message)) {
        if (typeof item === 'string') {
          fullText += item
          writeSSE(res, { type: 'chunk', text: item })
        } else if (item.type === 'suggestions') {
          suggestions = item.items
          writeSSE(res, { type: 'suggestions', items: item.items })
        } else if (item.type === 'save_english_mistake') {
          await db.saveEnglishMistake(uid, conversationId, item.data)
          writeSSE(res, { type: 'progress', message: 'Saving learning point...' })
        }
      }
      await db.addMessage(conversationId, 'assistant', fullText, suggestions)
      await db.updateConversationLastMessage(conversationId, fullText)
      writeSSE(res, { type: 'progress', message: 'Done' })
      writeSSE(res, { type: 'done' })
    } catch (err) {
      console.error(err)
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' } as ErrorResponse)
      } else {
        writeSSE(res, { type: 'error', message: 'Internal server error' })
      }
    } finally {
      if (!res.writableEnded) res.end()
    }
  })

  router.post<{ id: string }, unknown, SendMessageRequest>('/:id/messages', async (req, res) => {
    const { message } = req.body
    const uid = req.uid!
    const { id } = req.params
    if (!message?.trim()) {
      res.status(400).json({ error: 'message is required' } as ErrorResponse)
      return
    }
    try {
      const conversation = await db.getConversation(id, uid)
      if (!conversation) {
        res.status(404).json({ error: 'Conversation not found' } as ErrorResponse)
        return
      }
      const history = await db.getMessages(id)
      const aiHistory = history.map(({ role, content }) => ({ role, content }))
      await db.addMessage(id, 'user', message)

      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')

      writeSSE(res, { type: 'progress', message: 'Analyzing your message...' })

      let fullText = ''
      let suggestions: string[] | undefined
      for await (const item of ai.chatStream(aiHistory, message)) {
        if (typeof item === 'string') {
          fullText += item
          writeSSE(res, { type: 'chunk', text: item })
        } else if (item.type === 'suggestions') {
          suggestions = item.items
          writeSSE(res, { type: 'suggestions', items: item.items })
        } else if (item.type === 'save_english_mistake') {
          await db.saveEnglishMistake(uid, id, item.data)
          writeSSE(res, { type: 'progress', message: 'Saving learning point...' })
        }
      }
      await db.addMessage(id, 'assistant', fullText, suggestions)
      await db.updateConversationLastMessage(id, fullText)
      writeSSE(res, { type: 'progress', message: 'Done' })
      writeSSE(res, { type: 'done' })
    } catch (err) {
      console.error(err)
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' } as ErrorResponse)
      } else {
        writeSSE(res, { type: 'error', message: 'Internal server error' })
      }
    } finally {
      if (!res.writableEnded) res.end()
    }
  })

  router.get<Record<string, never>, ConversationSummary[] | ErrorResponse>(
    '/',
    async (req, res) => {
      try {
        const uid = req.uid!
        const conversations = await db.listConversations(uid)
        res.json(
          conversations.map((c) => ({
            id: c.id,
            title: c.title,
            lastMessage: c.lastMessage,
            updatedAt: c.updatedAt.toDate().toISOString(),
          }))
        )
      } catch (err) {
        console.error(err)
        res.status(500).json({ error: 'Internal server error' })
      }
    }
  )

  router.get<{ id: string }, MessageResponse[] | ErrorResponse>(
    '/:id/messages',
    async (req, res) => {
      try {
        const uid = req.uid!
        const { id } = req.params
        const conversation = await db.getConversation(id, uid)
        if (!conversation) {
          res.status(404).json({ error: 'Conversation not found' })
          return
        }
        const messages = await db.getMessages(id)
        res.json(messages)
      } catch (err) {
        console.error(err)
        res.status(500).json({ error: 'Internal server error' })
      }
    }
  )

  router.delete<{ id: string }, ErrorResponse | void>('/:id', async (req, res) => {
    try {
      const uid = req.uid!
      const { id } = req.params
      const conversation = await db.getConversation(id, uid)
      if (!conversation) {
        res.status(404).json({ error: 'Conversation not found' })
        return
      }
      await db.deleteConversation(id)
      res.status(204).send()
    } catch (err) {
      console.error(err)
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  return router
}
```

- [ ] **Step 4: Run all conversations tests to confirm they pass**

```bash
cd backend && npx vitest run src/routes/conversations.test.ts
```

Expected: all tests pass including the four new ones.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/conversations.ts backend/src/routes/conversations.test.ts
git commit -m "feat: handle save_english_mistake stream item and emit progress SSE events"
```

---

## Task 4: Add `onProgress` callback to frontend API

**Files:**
- Modify: `frontend/src/api.ts`
- Modify: `frontend/src/api.test.ts`

**Interfaces:**
- Consumes: `progress` SSE event (backend emits in Task 3)
- Produces: `onProgress?: (message: string) => void` in `StreamCallbacks`

- [ ] **Step 1: Write the failing test in `frontend/src/api.test.ts`**

Add inside `describe('api.sendMessage', ...)` after the last existing test:

```ts
it('calls onProgress for each progress event', async () => {
  mockStreamResponse([
    { type: 'progress', message: 'Analyzing your message...' },
    { type: 'chunk', text: 'Hello' },
    { type: 'progress', message: 'Done' },
    { type: 'done' },
  ])
  const onProgress = vi.fn()
  const onChunk = vi.fn()
  const onDone = vi.fn()
  const onError = vi.fn()
  await api.sendMessage('c1', 'hi', { onProgress, onChunk, onDone, onError })
  expect(onProgress).toHaveBeenNthCalledWith(1, 'Analyzing your message...')
  expect(onProgress).toHaveBeenNthCalledWith(2, 'Done')
})
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd frontend && npx vitest run src/api.test.ts
```

Expected: the new test fails.

- [ ] **Step 3: Implement the changes in `frontend/src/api.ts`**

Replace the entire file with:

```ts
import { auth } from './firebase'
import type { Conversation, Message } from './types'

const BASE_URL = import.meta.env.VITE_API_URL ?? ''

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = await auth.currentUser?.getIdToken()
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...options?.headers,
    },
  })
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  if (res.status === 204) return undefined as T
  return res.json()
}

export interface StreamCallbacks {
  onMeta?: (meta: { conversationId: string; title: string }) => void
  onChunk: (text: string) => void
  onSuggestions?: (items: string[]) => void
  onProgress?: (message: string) => void
  onDone: () => void
  onError: (message: string) => void
}

async function streamRequest(
  path: string,
  body: unknown,
  callbacks: StreamCallbacks
): Promise<void> {
  const token = await auth.currentUser?.getIdToken()
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`API error: ${res.status}`)

  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop()!
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const event = JSON.parse(line.slice(6)) as {
        type: string
        text?: string
        conversationId?: string
        title?: string
        message?: string
        items?: string[]
      }
      if (event.type === 'chunk') callbacks.onChunk(event.text!)
      else if (event.type === 'meta')
        callbacks.onMeta?.({ conversationId: event.conversationId!, title: event.title! })
      else if (event.type === 'suggestions') callbacks.onSuggestions?.(event.items!)
      else if (event.type === 'progress') callbacks.onProgress?.(event.message!)
      else if (event.type === 'done') callbacks.onDone()
      else if (event.type === 'error') callbacks.onError(event.message!)
    }
  }
}

export const api = {
  listConversations: () => request<Conversation[]>('/api/conversations'),

  getMessages: (conversationId: string) =>
    request<Message[]>(`/api/conversations/${conversationId}/messages`),

  createConversation: (message: string, callbacks: StreamCallbacks) =>
    streamRequest('/api/conversations', { message }, callbacks),

  sendMessage: (conversationId: string, message: string, callbacks: StreamCallbacks) =>
    streamRequest(`/api/conversations/${conversationId}/messages`, { message }, callbacks),

  deleteConversation: (conversationId: string) =>
    request<void>(`/api/conversations/${conversationId}`, { method: 'DELETE' }),
}
```

- [ ] **Step 4: Run all frontend API tests to confirm they pass**

```bash
cd frontend && npx vitest run src/api.test.ts
```

Expected: all tests pass including the new one.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api.ts frontend/src/api.test.ts
git commit -m "feat: add onProgress callback to StreamCallbacks and handle progress SSE events"
```

---

## Task 5: ThinkingProgress component + MessageList + ChatPage wiring

**Files:**
- Create: `frontend/src/components/ThinkingProgress.tsx`
- Create: `frontend/src/components/ThinkingProgress.test.tsx`
- Modify: `frontend/src/components/MessageList.tsx`
- Modify: `frontend/src/components/MessageList.test.tsx`
- Modify: `frontend/src/pages/ChatPage.tsx`

**Interfaces:**
- Consumes: `onProgress` from `StreamCallbacks` (Task 4)
- Produces: `ThinkingProgress` component; `progressSteps` prop on `MessageList`

- [ ] **Step 1: Write failing tests for `ThinkingProgress` in `frontend/src/components/ThinkingProgress.test.tsx`**

Create new file:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import ThinkingProgress from './ThinkingProgress'

describe('ThinkingProgress', () => {
  it('renders each step', () => {
    render(<ThinkingProgress steps={['Analyzing your message...', 'Saving learning point...']} />)
    expect(screen.getByText('Analyzing your message...')).toBeInTheDocument()
    expect(screen.getByText('Saving learning point...')).toBeInTheDocument()
  })

  it('renders nothing when steps is empty', () => {
    const { container } = render(<ThinkingProgress steps={[]} />)
    expect(container.firstChild).toBeNull()
  })
})
```

- [ ] **Step 2: Write failing tests for `MessageList` progress rendering in `frontend/src/components/MessageList.test.tsx`**

Add inside the existing `describe('MessageList', ...)` block after the last test:

```tsx
it('renders progress steps above the last assistant message', () => {
  render(
    <MessageList
      messages={[msg('assistant', 'Hello')]}
      progressSteps={['Analyzing your message...', 'Saving learning point...']}
    />
  )
  expect(screen.getByText('Analyzing your message...')).toBeInTheDocument()
  expect(screen.getByText('Saving learning point...')).toBeInTheDocument()
})

it('does not render progress steps when progressSteps is empty', () => {
  render(
    <MessageList
      messages={[msg('assistant', 'Hello')]}
      progressSteps={[]}
    />
  )
  expect(screen.queryByText('Analyzing your message...')).toBeNull()
})

it('only renders progress steps for the last assistant message', () => {
  render(
    <MessageList
      messages={[
        msg('assistant', 'First reply'),
        msg('user', 'Follow up'),
        msg('assistant', 'Second reply'),
      ]}
      progressSteps={['Analyzing your message...']}
    />
  )
  // Progress is rendered once (above last assistant), not for the first assistant message
  expect(screen.getAllByText('Analyzing your message...')).toHaveLength(1)
})
```

- [ ] **Step 3: Run tests to confirm they fail**

```bash
cd frontend && npx vitest run src/components/ThinkingProgress.test.tsx src/components/MessageList.test.tsx
```

Expected: all new tests fail (ThinkingProgress not found; progressSteps prop not handled).

- [ ] **Step 4: Create `frontend/src/components/ThinkingProgress.tsx`**

```tsx
interface Props {
  steps: string[]
}

export default function ThinkingProgress({ steps }: Props) {
  if (steps.length === 0) return null
  return (
    <div className="text-xs text-gray-400 flex flex-col gap-0.5 mb-1 px-1">
      {steps.map((step, i) => (
        <span key={i}>{step}</span>
      ))}
    </div>
  )
}
```

- [ ] **Step 5: Update `frontend/src/components/MessageList.tsx`**

Replace the entire file with:

```tsx
import { useEffect, useRef } from 'react'
import type { Message } from '../types'
import MarkdownMessage from './MarkdownMessage'
import SuggestionButtons from './SuggestionButtons'
import ThinkingProgress from './ThinkingProgress'

interface Props {
  messages: Message[]
  onSuggestionClick?: (text: string) => void
  progressSteps?: string[]
}

export default function MessageList({ messages, onSuggestionClick, progressSteps = [] }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, progressSteps])

  return (
    <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
      {messages.map((m, i) => {
        const nextMsg = messages[i + 1]
        const hasFollowUp = nextMsg?.role === 'user'
        const selectedItem =
          hasFollowUp && m.suggestions?.includes(nextMsg.content)
            ? nextMsg.content
            : undefined
        const isLastAssistant = i === messages.length - 1 && m.role === 'assistant'

        return (
          <div
            key={i}
            className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}
          >
            {isLastAssistant && progressSteps.length > 0 && (
              <ThinkingProgress steps={progressSteps} />
            )}
            <div
              className={`max-w-[80%] px-3.5 py-2.5 text-sm leading-relaxed break-words ${
                m.role === 'user'
                  ? 'bg-[#0084ff] text-white rounded-[18px_18px_4px_18px] whitespace-pre-wrap'
                  : 'bg-gray-200 text-gray-900 rounded-[18px_18px_18px_4px]'
              }`}
            >
              {m.role === 'user' ? m.content : <MarkdownMessage content={m.content} />}
            </div>
            {m.role === 'assistant' && m.suggestions && m.suggestions.length > 0 && (
              <SuggestionButtons
                items={m.suggestions}
                selectedItem={selectedItem}
                disabled={hasFollowUp}
                onSelect={onSuggestionClick ?? (() => {})}
              />
            )}
          </div>
        )
      })}
      <div ref={bottomRef} />
    </div>
  )
}
```

- [ ] **Step 6: Run component tests to confirm they pass**

```bash
cd frontend && npx vitest run src/components/ThinkingProgress.test.tsx src/components/MessageList.test.tsx
```

Expected: all tests pass including all new ones.

- [ ] **Step 7: Update `frontend/src/pages/ChatPage.tsx`**

Replace the entire file with:

```tsx
import { useState, useEffect, useCallback } from 'react'
import { signOut } from 'firebase/auth'
import type { User } from 'firebase/auth'
import { auth } from '../firebase'
import { api } from '../api'
import type { Conversation, Message } from '../types'
import MessageList from '../components/MessageList'
import MessageInput from '../components/MessageInput'
import HistoryDrawer from '../components/HistoryDrawer'

interface Props {
  user: User
}

export default function ChatPage({ user }: Props) {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [sending, setSending] = useState(false)
  const [progressSteps, setProgressSteps] = useState<string[]>([])
  const [drawerOpen, setDrawerOpen] = useState(false)

  useEffect(() => {
    api.listConversations().then(setConversations).catch(console.error)
  }, [])

  const loadConversation = useCallback(async (id: string) => {
    setActiveId(id)
    setDrawerOpen(false)
    const msgs = await api.getMessages(id)
    setMessages(msgs)
  }, [])

  async function handleSend(text: string) {
    if (sending) return
    setProgressSteps([])
    setSending(true)
    const userMsg: Message = { role: 'user', content: text, createdAt: new Date().toISOString() }
    const placeholder: Message = {
      role: 'assistant',
      content: '',
      createdAt: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, userMsg, placeholder])

    const appendChunk = (chunk: string) => {
      setMessages((prev) => {
        const msgs = [...prev]
        msgs[msgs.length - 1] = {
          ...msgs[msgs.length - 1],
          content: msgs[msgs.length - 1].content + chunk,
        }
        return msgs
      })
    }

    const onSuggestions = (items: string[]) => {
      setMessages((prev) => {
        const msgs = [...prev]
        msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], suggestions: items }
        return msgs
      })
    }

    const onProgress = (msg: string) => {
      setProgressSteps((prev) => [...prev, msg])
    }

    const onError = () => {
      setMessages((prev) => prev.slice(0, -1))
      setSending(false)
    }

    try {
      if (!activeId) {
        let newId = ''
        let accumulated = ''
        await api.createConversation(text, {
          onMeta: ({ conversationId, title }) => {
            newId = conversationId
            setActiveId(conversationId)
            setConversations((prev) => [
              { id: conversationId, title, lastMessage: '', updatedAt: new Date().toISOString() },
              ...prev,
            ])
          },
          onChunk: (chunk) => {
            accumulated += chunk
            appendChunk(chunk)
          },
          onSuggestions,
          onProgress,
          onDone: () => {
            setConversations((prev) =>
              prev.map((c) =>
                c.id === newId
                  ? { ...c, lastMessage: accumulated, updatedAt: new Date().toISOString() }
                  : c
              )
            )
            setSending(false)
          },
          onError,
        })
      } else {
        const id = activeId
        let accumulated = ''
        await api.sendMessage(id, text, {
          onChunk: (chunk) => {
            accumulated += chunk
            appendChunk(chunk)
          },
          onSuggestions,
          onProgress,
          onDone: () => {
            setConversations((prev) =>
              prev.map((c) =>
                c.id === id
                  ? { ...c, lastMessage: accumulated, updatedAt: new Date().toISOString() }
                  : c
              )
            )
            setSending(false)
          },
          onError,
        })
      }
    } catch (e) {
      console.error(e)
      onError()
    }
  }

  async function handleDelete(id: string) {
    await api.deleteConversation(id)
    setConversations((prev) => prev.filter((c) => c.id !== id))
    if (activeId === id) {
      setActiveId(null)
      setMessages([])
    }
  }

  function handleNewChat() {
    setActiveId(null)
    setMessages([])
    setDrawerOpen(false)
  }

  return (
    <div className="flex flex-col h-dvh max-w-[600px] mx-auto relative">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-white">
        <button
          onClick={() => setDrawerOpen(true)}
          className="bg-transparent border-none text-xl cursor-pointer p-1 leading-none"
        >
          ☰
        </button>
        <span className="font-bold">corgi</span>
        <img
          src={user.photoURL ?? undefined}
          alt={user.displayName ?? 'user'}
          onClick={() => signOut(auth)}
          title="Sign out"
          className="w-8 h-8 rounded-full cursor-pointer"
        />
      </div>

      {messages.length === 0 && !sending ? (
        <div className="flex-1 flex items-center justify-center text-gray-400">
          Start a conversation
        </div>
      ) : (
        <MessageList
          messages={messages}
          onSuggestionClick={handleSend}
          progressSteps={sending ? progressSteps : []}
        />
      )}

      <MessageInput onSend={handleSend} disabled={sending} />

      {drawerOpen && (
        <HistoryDrawer
          conversations={conversations}
          activeId={activeId}
          onSelect={loadConversation}
          onDelete={handleDelete}
          onNewChat={handleNewChat}
          onClose={() => setDrawerOpen(false)}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 8: Run all frontend tests to confirm they pass**

```bash
cd frontend && npm test
```

Expected: all tests pass.

- [ ] **Step 9: Run all backend tests to confirm nothing broke**

```bash
cd backend && npm test
```

Expected: all tests pass.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/components/ThinkingProgress.tsx frontend/src/components/ThinkingProgress.test.tsx frontend/src/components/MessageList.tsx frontend/src/components/MessageList.test.tsx frontend/src/pages/ChatPage.tsx
git commit -m "feat: add ThinkingProgress component and wire progressSteps through ChatPage and MessageList"
```
