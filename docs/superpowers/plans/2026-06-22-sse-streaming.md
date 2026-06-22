# SSE Streaming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace blocking JSON responses on the two POST message endpoints with SSE streaming so users see AI response tokens appear progressively.

**Architecture:** Both `POST /api/conversations` and `POST /api/conversations/:id/messages` set `Content-Type: text/event-stream` and write JSON events per chunk. The frontend uses `fetch` + `ReadableStream` + `TextDecoder` to parse SSE lines and appends each chunk to an in-progress placeholder message in state. Firestore writes for the complete assistant message happen after the stream ends, server-side.

**Tech Stack:** Express (Node.js/TypeScript), Google Gemini SDK (`@google/generative-ai`), React + TypeScript, Vitest, supertest

## Global Constraints

- All validation returning 4xx/5xx errors MUST happen before SSE headers are set — responses before streaming use plain JSON
- The backend accumulates all chunks and saves the full assistant message to Firestore AFTER the stream ends, not per-chunk
- Auth is unchanged: Firebase JWT sent as `Authorization: Bearer <token>` in request header
- SSE event format: `data: <json>\n\n` where each JSON object has a `type` field
- Tests use Vitest; run with `npm test` in the respective `backend/` or `frontend/` directory

---

## File Map

**Backend — modified:**
- `backend/src/providers/AIProvider.ts` — Remove `chat()`, add `chatStream()` returning `AsyncIterable<string>`
- `backend/src/providers/GeminiProvider.ts` — Implement `chatStream()` using `sendMessageStream()`
- `backend/src/providers/GeminiProvider.test.ts` — Replace `chat()` tests with `chatStream()` tests
- `backend/src/models/api.ts` — Remove `SendMessageResponse` and `CreateConversationResponse`; add `SSEEvent` discriminated union
- `backend/src/routes/conversations.ts` — Update both POST endpoints to stream SSE
- `backend/src/routes/conversations.test.ts` — Update POST tests to parse SSE; keep GET/DELETE tests unchanged

**Frontend — modified:**
- `frontend/src/api.ts` — Add `StreamCallbacks` interface and `streamRequest()` helper; change `createConversation` and `sendMessage` signatures
- `frontend/src/api.test.ts` — Replace JSON mock tests with streaming mock tests for `createConversation` and `sendMessage`
- `frontend/src/pages/ChatPage.tsx` — Update `handleSend` to append chunks to a placeholder message

---

### Task 1: Update AIProvider interface and GeminiProvider to stream

**Files:**
- Modify: `backend/src/providers/AIProvider.ts`
- Modify: `backend/src/providers/GeminiProvider.ts`
- Test: `backend/src/providers/GeminiProvider.test.ts`

**Interfaces:**
- Produces: `AIProvider.chatStream(history: Message[], newMessage: string): AsyncIterable<string>`

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `backend/src/providers/GeminiProvider.test.ts`:

```typescript
import { beforeEach, describe, it, expect, vi } from 'vitest'

const mockSendMessageStream = vi.fn()
const mockStartChat = vi.fn(() => ({ sendMessageStream: mockSendMessageStream }))
const mockGetGenerativeModel = vi.fn(() => ({ startChat: mockStartChat }))

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
    getGenerativeModel: mockGetGenerativeModel,
  })),
}))

import { GeminiProvider } from './GeminiProvider'

async function collectStream(stream: AsyncIterable<string>): Promise<string[]> {
  const chunks: string[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

describe('GeminiProvider', () => {
  beforeEach(() => vi.clearAllMocks())

  it('yields text chunks from Gemini stream', async () => {
    async function* fakeStream() {
      yield { text: () => 'Hello' }
      yield { text: () => ' world' }
    }
    mockSendMessageStream.mockResolvedValue({ stream: fakeStream() })
    const provider = new GeminiProvider('fake-key')
    const chunks = await collectStream(provider.chatStream([], 'Hi'))
    expect(chunks).toEqual(['Hello', ' world'])
  })

  it('maps assistant role to "model" when building history', async () => {
    async function* fakeStream() { yield { text: () => 'reply' } }
    mockSendMessageStream.mockResolvedValue({ stream: fakeStream() })
    const provider = new GeminiProvider('fake-key')
    await collectStream(provider.chatStream(
      [
        { role: 'user', content: 'first message' },
        { role: 'assistant', content: 'first reply' },
      ],
      'second message'
    ))
    expect(mockStartChat).toHaveBeenCalledWith({
      history: [
        { role: 'user', parts: [{ text: 'first message' }] },
        { role: 'model', parts: [{ text: 'first reply' }] },
      ],
    })
  })

  it('skips empty text chunks', async () => {
    async function* fakeStream() {
      yield { text: () => 'Hello' }
      yield { text: () => '' }
      yield { text: () => ' world' }
    }
    mockSendMessageStream.mockResolvedValue({ stream: fakeStream() })
    const provider = new GeminiProvider('fake-key')
    const chunks = await collectStream(provider.chatStream([], 'Hi'))
    expect(chunks).toEqual(['Hello', ' world'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- providers/GeminiProvider`
Expected: FAIL — `provider.chatStream is not a function`

- [ ] **Step 3: Update AIProvider interface**

Replace the full contents of `backend/src/providers/AIProvider.ts`:

```typescript
export interface Message {
  role: 'user' | 'assistant'
  content: string
}

export interface AIProvider {
  chatStream(history: Message[], newMessage: string): AsyncIterable<string>
}
```

- [ ] **Step 4: Implement `chatStream` in GeminiProvider**

Replace the full contents of `backend/src/providers/GeminiProvider.ts`:

```typescript
import { GoogleGenerativeAI } from '@google/generative-ai'
import type { AIProvider, Message } from './AIProvider'

export class GeminiProvider implements AIProvider {
  private model: ReturnType<InstanceType<typeof GoogleGenerativeAI>['getGenerativeModel']>

  constructor(apiKey: string) {
    const client = new GoogleGenerativeAI(apiKey)
    this.model = client.getGenerativeModel({ model: 'gemini-2.5-flash-lite' })
  }

  async *chatStream(history: Message[], newMessage: string): AsyncIterable<string> {
    const chat = this.model.startChat({
      history: history.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
    })
    const result = await chat.sendMessageStream(newMessage)
    for await (const chunk of result.stream) {
      const text = chunk.text()
      if (text) yield text
    }
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && npm test -- providers/GeminiProvider`
Expected: PASS — 3 tests passing

- [ ] **Step 6: Commit**

```bash
git add backend/src/providers/AIProvider.ts backend/src/providers/GeminiProvider.ts backend/src/providers/GeminiProvider.test.ts
git commit -m "feat: replace AIProvider.chat with chatStream returning AsyncIterable"
```

---

### Task 2: Update backend routes for SSE streaming

**Files:**
- Modify: `backend/src/models/api.ts`
- Modify: `backend/src/routes/conversations.ts`
- Test: `backend/src/routes/conversations.test.ts`

**Interfaces:**
- Consumes: `AIProvider.chatStream(history: Message[], newMessage: string): AsyncIterable<string>` (from Task 1)
- Produces: `POST /api/conversations` streams `{ type: 'meta', conversationId, title }` then chunks then `{ type: 'done' }`; `POST /api/conversations/:id/messages` streams chunks then `{ type: 'done' }`

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `backend/src/routes/conversations.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import type { Request, Response, NextFunction } from 'express'
import type { AIProvider } from '../providers/AIProvider'

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
  getMessages: vi.fn().mockResolvedValue(
    [] as Array<{ role: 'user' | 'assistant'; content: string; createdAt: string }>
  ),
  updateConversationLastMessage: vi.fn().mockResolvedValue(undefined),
  deleteConversation: vi.fn().mockResolvedValue(undefined),
}))

import { createConversationsRouter } from './conversations'
import * as firestoreService from '../services/firestore'

async function* defaultStream() { yield 'AI reply' }

const mockAI: AIProvider = {
  chatStream: vi.fn().mockReturnValue(defaultStream()),
}

function mockAuth(req: Request, _: Response, next: NextFunction) {
  req.uid = 'u1'
  next()
}

const app = express()
app.use(express.json())
app.use('/api/conversations', mockAuth, createConversationsRouter(mockAI))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(mockAI.chatStream).mockReturnValue(defaultStream())
})

function parseSSE(text: string): Array<{ type: string; [key: string]: unknown }> {
  return text
    .split('\n')
    .filter((l) => l.startsWith('data: '))
    .map((l) => JSON.parse(l.slice(6)))
}

describe('POST /api/conversations', () => {
  it('streams meta, chunk, and done events', async () => {
    async function* stream() { yield 'Hello'; yield ' world' }
    vi.mocked(mockAI.chatStream).mockReturnValue(stream())
    const res = await request(app)
      .post('/api/conversations')
      .send({ message: 'Hello world' })
      .buffer(true)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('text/event-stream')
    const events = parseSSE(res.text)
    expect(events[0]).toEqual({ type: 'meta', conversationId: 'conv123', title: 'Hello world' })
    expect(events[1]).toEqual({ type: 'chunk', text: 'Hello' })
    expect(events[2]).toEqual({ type: 'chunk', text: ' world' })
    expect(events[3]).toEqual({ type: 'done' })
  })

  it('returns 400 JSON when message is missing', async () => {
    const res = await request(app).post('/api/conversations').send({})
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('message is required')
  })

  it('truncates title to 40 chars', async () => {
    await request(app)
      .post('/api/conversations')
      .send({ message: 'A'.repeat(60) })
      .buffer(true)
    expect(firestoreService.createConversation).toHaveBeenCalledWith('u1', 'A'.repeat(40))
  })

  it('saves full accumulated assistant message to Firestore', async () => {
    async function* stream() { yield 'Hello'; yield ' world' }
    vi.mocked(mockAI.chatStream).mockReturnValue(stream())
    await request(app)
      .post('/api/conversations')
      .send({ message: 'Hi' })
      .buffer(true)
    expect(firestoreService.addMessage).toHaveBeenCalledWith('conv123', 'assistant', 'Hello world')
  })
})

describe('POST /api/conversations/:id/messages', () => {
  it('streams chunk and done events', async () => {
    async function* stream() { yield 'AI reply' }
    vi.mocked(mockAI.chatStream).mockReturnValue(stream())
    const res = await request(app)
      .post('/api/conversations/conv123/messages')
      .send({ message: 'Follow up' })
      .buffer(true)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('text/event-stream')
    const events = parseSSE(res.text)
    expect(events[0]).toEqual({ type: 'chunk', text: 'AI reply' })
    expect(events[1]).toEqual({ type: 'done' })
  })

  it('returns 404 JSON when conversation not found', async () => {
    vi.mocked(firestoreService.getConversation).mockResolvedValueOnce(null)
    const res = await request(app)
      .post('/api/conversations/missing/messages')
      .send({ message: 'hi' })
    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Conversation not found')
  })

  it('returns 400 JSON when message is missing', async () => {
    const res = await request(app).post('/api/conversations/conv123/messages').send({})
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('message is required')
  })

  it('saves full accumulated assistant message to Firestore', async () => {
    async function* stream() { yield 'Hello'; yield ' world' }
    vi.mocked(mockAI.chatStream).mockReturnValue(stream())
    await request(app)
      .post('/api/conversations/conv123/messages')
      .send({ message: 'Follow up' })
      .buffer(true)
    expect(firestoreService.addMessage).toHaveBeenCalledWith('conv123', 'assistant', 'Hello world')
  })
})

describe('GET /api/conversations', () => {
  it('returns conversation list', async () => {
    const res = await request(app).get('/api/conversations')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].id).toBe('conv123')
  })
})

describe('GET /api/conversations/:id/messages', () => {
  it('returns messages array', async () => {
    vi.mocked(firestoreService.getMessages).mockResolvedValueOnce([
      { role: 'user', content: 'Hello', createdAt: '2024-01-01T00:00:00.000Z' },
      { role: 'assistant', content: 'Hi there', createdAt: '2024-01-01T00:00:01.000Z' },
    ])
    const res = await request(app).get('/api/conversations/conv123/messages')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(2)
    expect(res.body[0].role).toBe('user')
  })
})

describe('DELETE /api/conversations/:id', () => {
  it('returns 204', async () => {
    const res = await request(app).delete('/api/conversations/conv123')
    expect(res.status).toBe(204)
  })

  it('returns 404 when conversation not found', async () => {
    vi.mocked(firestoreService.getConversation).mockResolvedValueOnce(null)
    const res = await request(app).delete('/api/conversations/missing')
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npm test -- routes/conversations`
Expected: FAIL — SSE tests fail because routes still return JSON

- [ ] **Step 3: Update API model types**

Replace the full contents of `backend/src/models/api.ts`:

```typescript
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
}

// SSE event types for POST /api/conversations and POST /api/conversations/:id/messages
export type SSEEvent =
  | { type: 'meta'; conversationId: string; title: string }
  | { type: 'chunk'; text: string }
  | { type: 'done' }
  | { type: 'error'; message: string }

// Error response (all non-SSE endpoints)
export interface ErrorResponse {
  error: string
}
```

- [ ] **Step 4: Update conversations route to stream SSE**

Replace the full contents of `backend/src/routes/conversations.ts`:

```typescript
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

  router.post<{}, never, CreateConversationRequest>('/', async (req, res) => {
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

      let fullText = ''
      for await (const chunk of ai.chatStream([], message)) {
        fullText += chunk
        writeSSE(res, { type: 'chunk', text: chunk })
      }
      await db.addMessage(conversationId, 'assistant', fullText)
      await db.updateConversationLastMessage(conversationId, fullText)
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

  router.post<{ id: string }, never, SendMessageRequest>(
    '/:id/messages',
    async (req, res) => {
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

        let fullText = ''
        for await (const chunk of ai.chatStream(aiHistory, message)) {
          fullText += chunk
          writeSSE(res, { type: 'chunk', text: chunk })
        }
        await db.addMessage(id, 'assistant', fullText)
        await db.updateConversationLastMessage(id, fullText)
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
    }
  )

  router.get<{}, ConversationSummary[] | ErrorResponse>('/', async (req, res) => {
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
  })

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

- [ ] **Step 5: Run route tests to verify they pass**

Run: `cd backend && npm test -- routes/conversations`
Expected: PASS — all tests passing

- [ ] **Step 6: Run all backend tests**

Run: `cd backend && npm test`
Expected: PASS — all backend tests passing

- [ ] **Step 7: Commit**

```bash
git add backend/src/models/api.ts backend/src/routes/conversations.ts backend/src/routes/conversations.test.ts
git commit -m "feat: stream SSE from POST conversation endpoints"
```

---

### Task 3: Update frontend api.ts for SSE streaming

**Files:**
- Modify: `frontend/src/api.ts`
- Test: `frontend/src/api.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  export interface StreamCallbacks {
    onMeta?: (meta: { conversationId: string; title: string }) => void
    onChunk: (text: string) => void
    onDone: () => void
    onError: (message: string) => void
  }
  api.createConversation(message: string, callbacks: StreamCallbacks): Promise<void>
  api.sendMessage(conversationId: string, message: string, callbacks: StreamCallbacks): Promise<void>
  ```

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `frontend/src/api.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./firebase', () => ({
  auth: {
    currentUser: {
      getIdToken: vi.fn().mockResolvedValue('test-token'),
    },
  },
}))

import { api } from './api'

const mockFetch = vi.fn()
global.fetch = mockFetch

beforeEach(() => { vi.clearAllMocks() })

function mockResponse(body: unknown, status = 200) {
  mockFetch.mockResolvedValue({
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
  })
}

function mockStreamResponse(events: object[]) {
  const encoder = new TextEncoder()
  const lines = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('')
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(lines))
      controller.close()
    },
  })
  mockFetch.mockResolvedValue({ ok: true, status: 200, body: stream })
}

describe('api.listConversations', () => {
  it('sends GET /api/conversations with Authorization header', async () => {
    mockResponse([{ id: 'c1', title: 'Test', lastMessage: 'hi', updatedAt: '' }])
    const result = await api.listConversations()
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/conversations'),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
      })
    )
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('c1')
  })
})

describe('api.createConversation', () => {
  it('calls onMeta, onChunk for each chunk, and onDone', async () => {
    mockStreamResponse([
      { type: 'meta', conversationId: 'c1', title: 'Hello' },
      { type: 'chunk', text: 'Hi ' },
      { type: 'chunk', text: 'there' },
      { type: 'done' },
    ])
    const onMeta = vi.fn()
    const onChunk = vi.fn()
    const onDone = vi.fn()
    const onError = vi.fn()
    await api.createConversation('Hello', { onMeta, onChunk, onDone, onError })
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/conversations'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ message: 'Hello' }),
      })
    )
    expect(onMeta).toHaveBeenCalledWith({ conversationId: 'c1', title: 'Hello' })
    expect(onChunk).toHaveBeenNthCalledWith(1, 'Hi ')
    expect(onChunk).toHaveBeenNthCalledWith(2, 'there')
    expect(onDone).toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
  })
})

describe('api.sendMessage', () => {
  it('calls onChunk for each chunk and onDone', async () => {
    mockStreamResponse([
      { type: 'chunk', text: 'Hello' },
      { type: 'chunk', text: ' world' },
      { type: 'done' },
    ])
    const onChunk = vi.fn()
    const onDone = vi.fn()
    const onError = vi.fn()
    await api.sendMessage('c1', 'Follow up', { onChunk, onDone, onError })
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/conversations/c1/messages'),
      expect.objectContaining({ method: 'POST' })
    )
    expect(onChunk).toHaveBeenNthCalledWith(1, 'Hello')
    expect(onChunk).toHaveBeenNthCalledWith(2, ' world')
    expect(onDone).toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
  })

  it('calls onError when error event received', async () => {
    mockStreamResponse([{ type: 'error', message: 'Internal server error' }])
    const onChunk = vi.fn()
    const onDone = vi.fn()
    const onError = vi.fn()
    await api.sendMessage('c1', 'Follow up', { onChunk, onDone, onError })
    expect(onError).toHaveBeenCalledWith('Internal server error')
    expect(onDone).not.toHaveBeenCalled()
  })
})

describe('api.deleteConversation', () => {
  it('sends DELETE /api/conversations/:id', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 204 })
    await api.deleteConversation('c1')
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/conversations/c1'),
      expect.objectContaining({ method: 'DELETE' })
    )
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npm test -- api`
Expected: FAIL — `api.createConversation` and `api.sendMessage` have wrong call signatures

- [ ] **Step 3: Update api.ts with streaming support**

Replace the full contents of `frontend/src/api.ts`:

```typescript
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
      }
      if (event.type === 'chunk') callbacks.onChunk(event.text!)
      else if (event.type === 'meta')
        callbacks.onMeta?.({ conversationId: event.conversationId!, title: event.title! })
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm test -- api`
Expected: PASS — all tests passing

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api.ts frontend/src/api.test.ts
git commit -m "feat: replace api.createConversation and api.sendMessage with SSE streaming"
```

---

### Task 4: Update ChatPage to consume streaming API

**Files:**
- Modify: `frontend/src/pages/ChatPage.tsx`

**Interfaces:**
- Consumes: `api.createConversation(message, callbacks)` and `api.sendMessage(id, message, callbacks)` with `StreamCallbacks` (from Task 3)

- [ ] **Step 1: Update ChatPage.tsx**

Replace the full contents of `frontend/src/pages/ChatPage.tsx`:

```typescript
import { useState, useEffect, useCallback } from 'react'
import { signOut } from 'firebase/auth'
import type { User } from 'firebase/auth'
import { auth } from '../firebase'
import { api } from '../api'
import type { Conversation, Message } from '../types'
import MessageList from '../components/MessageList'
import MessageInput from '../components/MessageInput'
import HistoryDrawer from '../components/HistoryDrawer'

interface Props { user: User }

export default function ChatPage({ user }: Props) {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [sending, setSending] = useState(false)
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
    setSending(true)
    const userMsg: Message = { role: 'user', content: text, createdAt: new Date().toISOString() }
    const placeholder: Message = { role: 'assistant', content: '', createdAt: new Date().toISOString() }
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
        <MessageList messages={messages} />
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

- [ ] **Step 2: Run all frontend tests**

Run: `cd frontend && npm test`
Expected: PASS — all tests passing

- [ ] **Step 3: Build frontend to check for TypeScript errors**

Run: `cd frontend && npm run build`
Expected: Build completes with exit code 0 and no TypeScript errors

- [ ] **Step 4: Manual smoke test**

Start the dev server (`cd frontend && npm run dev`) and open the app in a browser. Send a message and verify:
- Words appear progressively as the AI responds (not all at once)
- The conversation appears in the sidebar after the first message
- The sidebar shows the final `lastMessage` text after streaming completes
- Sending a follow-up message in the same conversation also streams correctly

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/ChatPage.tsx
git commit -m "feat: stream assistant response tokens progressively in ChatPage"
```
