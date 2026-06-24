# Suggestion Buttons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display interactive suggestion buttons below assistant messages, driven by Gemini function calling, persisted in Firestore, and rendered as clickable pills in the frontend.

**Architecture:** The backend registers a `suggest_options` Gemini function declaration. When Gemini calls it, `GeminiProvider` yields a structured `{ type: 'suggestions', items }` event alongside regular text chunks. The route handler forwards this as a new SSE event type and stores it in Firestore. The frontend attaches suggestions to the assistant message in state and renders pill buttons below the bubble; button state (active/selected/grayed) is derived from the message list.

**Tech Stack:** Node.js + Express + Vitest (backend), React + Tailwind CSS + Vitest + @testing-library/react (frontend), Firestore, `@google/generative-ai` SDK.

## Global Constraints

- Tailwind utility classes only — no inline styles, no CSS files
- Blue accent color is `#0084ff` throughout the app
- Test command backend: `cd backend && npm test`
- Test command frontend: `cd frontend && npm test`
- All tests must pass before each commit
- Never commit if TypeScript errors exist (`cd backend && npm run build` / `cd frontend && npm run build`)

---

### Task 1: Extend AIProvider stream type and update GeminiProvider to use function calling

**Files:**
- Modify: `backend/src/providers/AIProvider.ts`
- Modify: `backend/src/providers/GeminiProvider.ts`
- Modify: `backend/src/providers/GeminiProvider.test.ts`

**Interfaces:**
- Produces: `StreamItem = string | { type: 'suggestions'; items: string[] }` exported from `AIProvider.ts`
- Produces: `GeminiProvider.chatStream` now yields `StreamItem`

- [ ] **Step 1: Write failing tests for the new GeminiProvider behavior**

Replace the contents of `backend/src/providers/GeminiProvider.test.ts`:

```typescript
import { beforeEach, describe, it, expect, vi } from 'vitest'
import type { StreamItem } from './AIProvider'

const mockSendMessageStream = vi.fn()
const mockStartChat = vi.fn(() => ({ sendMessageStream: mockSendMessageStream }))
const mockGetGenerativeModel = vi.fn(() => ({ startChat: mockStartChat }))

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
    getGenerativeModel: mockGetGenerativeModel,
  })),
}))

import { GeminiProvider } from './GeminiProvider'

async function collectStream(stream: AsyncIterable<StreamItem>): Promise<StreamItem[]> {
  const items: StreamItem[] = []
  for await (const item of stream) items.push(item)
  return items
}

describe('GeminiProvider', () => {
  beforeEach(() => vi.clearAllMocks())

  it('yields text chunks from Gemini stream', async () => {
    async function* fakeStream() {
      yield { text: () => 'Hello', candidates: undefined }
      yield { text: () => ' world', candidates: undefined }
    }
    mockSendMessageStream.mockResolvedValue({ stream: fakeStream() })
    const provider = new GeminiProvider('fake-key')
    const items = await collectStream(provider.chatStream([], 'Hi'))
    expect(items).toEqual(['Hello', ' world'])
  })

  it('maps assistant role to "model" when building history', async () => {
    async function* fakeStream() {
      yield { text: () => 'reply', candidates: undefined }
    }
    mockSendMessageStream.mockResolvedValue({ stream: fakeStream() })
    const provider = new GeminiProvider('fake-key')
    await collectStream(
      provider.chatStream(
        [
          { role: 'user', content: 'first message' },
          { role: 'assistant', content: 'first reply' },
        ],
        'second message'
      )
    )
    expect(mockStartChat).toHaveBeenCalledWith(
      expect.objectContaining({
        history: [
          { role: 'user', parts: [{ text: 'first message' }] },
          { role: 'model', parts: [{ text: 'first reply' }] },
        ],
      })
    )
  })

  it('skips empty text chunks', async () => {
    async function* fakeStream() {
      yield { text: () => 'Hello', candidates: undefined }
      yield { text: () => '', candidates: undefined }
      yield { text: () => ' world', candidates: undefined }
    }
    mockSendMessageStream.mockResolvedValue({ stream: fakeStream() })
    const provider = new GeminiProvider('fake-key')
    const items = await collectStream(provider.chatStream([], 'Hi'))
    expect(items).toEqual(['Hello', ' world'])
  })

  it('yields suggestions item when Gemini calls suggest_options', async () => {
    async function* fakeStream() {
      yield { text: () => 'Here are your options.', candidates: undefined }
      yield {
        text: () => { throw new Error('no text') },
        candidates: [{
          content: {
            parts: [{
              functionCall: {
                name: 'suggest_options',
                args: { items: ['Yes', 'No', 'Maybe'] },
              },
            }],
          },
        }],
      }
    }
    mockSendMessageStream.mockResolvedValue({ stream: fakeStream() })
    const provider = new GeminiProvider('fake-key')
    const items = await collectStream(provider.chatStream([], 'Give me options'))
    expect(items).toEqual([
      'Here are your options.',
      { type: 'suggestions', items: ['Yes', 'No', 'Maybe'] },
    ])
  })

  it('ignores unknown function calls', async () => {
    async function* fakeStream() {
      yield { text: () => 'Done.', candidates: undefined }
      yield {
        text: () => { throw new Error('no text') },
        candidates: [{
          content: {
            parts: [{ functionCall: { name: 'unknown_tool', args: {} } }],
          },
        }],
      }
    }
    mockSendMessageStream.mockResolvedValue({ stream: fakeStream() })
    const provider = new GeminiProvider('fake-key')
    const items = await collectStream(provider.chatStream([], 'Hi'))
    expect(items).toEqual(['Done.'])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && npm test -- GeminiProvider
```

Expected: FAIL — `StreamItem` not found, `chatStream` type mismatch, function call test failing.

- [ ] **Step 3: Update AIProvider.ts to export StreamItem**

Replace `backend/src/providers/AIProvider.ts`:

```typescript
export interface Message {
  role: 'user' | 'assistant'
  content: string
}

export type StreamItem = string | { type: 'suggestions'; items: string[] }

export interface AIProvider {
  chatStream(history: Message[], newMessage: string): AsyncIterable<StreamItem>
}
```

- [ ] **Step 4: Update GeminiProvider.ts to use function calling**

Replace `backend/src/providers/GeminiProvider.ts`:

```typescript
import { GoogleGenerativeAI } from '@google/generative-ai'
import type { AIProvider, Message, StreamItem } from './AIProvider'

const suggestOptionsTool = {
  functionDeclarations: [
    {
      name: 'suggest_options',
      description:
        'Call at the end of your response to suggest next steps or options for the user to choose from as buttons.',
      parameters: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: { type: 'string' },
            description: '2 to 4 short button labels',
          },
        },
        required: ['items'],
      },
    },
  ],
}

export class GeminiProvider implements AIProvider {
  private model: ReturnType<InstanceType<typeof GoogleGenerativeAI>['getGenerativeModel']>

  constructor(apiKey: string) {
    const client = new GoogleGenerativeAI(apiKey)
    this.model = client.getGenerativeModel({
      model: 'gemini-2.5-flash-lite',
      systemInstruction:
        'You are a helpful assistant. When it would help the user to choose a next step, call the suggest_options function at the end of your response with 2 to 4 short button labels.',
    })
  }

  async *chatStream(history: Message[], newMessage: string): AsyncIterable<StreamItem> {
    const chat = this.model.startChat({
      history: history.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
      tools: [suggestOptionsTool],
    })
    const result = await chat.sendMessageStream(newMessage)
    for await (const chunk of result.stream) {
      try {
        const text = chunk.text()
        if (text) yield text
      } catch {
        // chunk contains no text (e.g. a function call part)
      }

      for (const candidate of chunk.candidates ?? []) {
        for (const part of candidate.content?.parts ?? []) {
          if (
            'functionCall' in part &&
            part.functionCall?.name === 'suggest_options'
          ) {
            const args = part.functionCall.args as { items?: string[] }
            if (Array.isArray(args?.items) && args.items.length > 0) {
              yield { type: 'suggestions', items: args.items }
            }
          }
        }
      }
    }
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd backend && npm test -- GeminiProvider
```

Expected: All 5 tests PASS.

- [ ] **Step 6: Verify TypeScript compiles**

```bash
cd backend && npm run build
```

Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add backend/src/providers/AIProvider.ts backend/src/providers/GeminiProvider.ts backend/src/providers/GeminiProvider.test.ts
git commit -m "feat: extend AIProvider stream type and add suggest_options function calling to GeminiProvider"
```

---

### Task 2: Add suggestions to backend API models and Firestore

**Files:**
- Modify: `backend/src/models/api.ts`
- Modify: `backend/src/services/firestore.ts`

**Interfaces:**
- Consumes: nothing new
- Produces: `SSEEvent` union includes `{ type: 'suggestions'; items: string[] }`, `MessageResponse` and `FirestoreMessage` include `suggestions?: string[]`, `addMessage` accepts optional `suggestions?: string[]` fourth param

- [ ] **Step 1: Update backend/src/models/api.ts**

Replace the file:

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
  suggestions?: string[]
}

// SSE event types for POST /api/conversations and POST /api/conversations/:id/messages
export type SSEEvent =
  | { type: 'meta'; conversationId: string; title: string }
  | { type: 'chunk'; text: string }
  | { type: 'suggestions'; items: string[] }
  | { type: 'done' }
  | { type: 'error'; message: string }

// Error response (all non-SSE endpoints)
export interface ErrorResponse {
  error: string
}
```

- [ ] **Step 2: Update backend/src/services/firestore.ts**

Replace the file:

```typescript
import { getFirestore, Timestamp } from 'firebase-admin/firestore'

export interface ConversationDoc {
  id: string
  uid: string
  title: string
  lastMessage: string
  createdAt: Timestamp
  updatedAt: Timestamp
}

export interface FirestoreMessage {
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  suggestions?: string[]
}

export async function createConversation(uid: string, title: string): Promise<string> {
  const db = getFirestore()
  const ref = await db.collection('conversations').add({
    uid,
    title,
    lastMessage: '',
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  })
  return ref.id
}

export async function getConversation(
  conversationId: string,
  uid: string
): Promise<ConversationDoc | null> {
  const db = getFirestore()
  const doc = await db.collection('conversations').doc(conversationId).get()
  if (!doc.exists || doc.data()?.uid !== uid) return null
  return { id: doc.id, ...doc.data() } as ConversationDoc
}

export async function listConversations(uid: string): Promise<ConversationDoc[]> {
  const db = getFirestore()
  const snap = await db
    .collection('conversations')
    .where('uid', '==', uid)
    .orderBy('updatedAt', 'desc')
    .get()
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ConversationDoc)
}

export async function addMessage(
  conversationId: string,
  role: 'user' | 'assistant',
  content: string,
  suggestions?: string[]
): Promise<void> {
  const db = getFirestore()
  const data: Record<string, unknown> = { role, content, createdAt: Timestamp.now() }
  if (suggestions && suggestions.length > 0) data.suggestions = suggestions
  await db
    .collection('conversations')
    .doc(conversationId)
    .collection('messages')
    .add(data)
}

export async function getMessages(conversationId: string): Promise<FirestoreMessage[]> {
  const db = getFirestore()
  const snap = await db
    .collection('conversations')
    .doc(conversationId)
    .collection('messages')
    .orderBy('createdAt', 'asc')
    .get()
  return snap.docs.map((d) => {
    const data = d.data()
    const msg: FirestoreMessage = {
      role: data.role as 'user' | 'assistant',
      content: data.content as string,
      createdAt: (data.createdAt as Timestamp).toDate().toISOString(),
    }
    if (Array.isArray(data.suggestions)) msg.suggestions = data.suggestions as string[]
    return msg
  })
}

export async function updateConversationLastMessage(
  conversationId: string,
  lastMessage: string
): Promise<void> {
  const db = getFirestore()
  await db.collection('conversations').doc(conversationId).update({
    lastMessage,
    updatedAt: Timestamp.now(),
  })
}

export async function deleteConversation(conversationId: string): Promise<void> {
  const db = getFirestore()
  const messagesSnap = await db
    .collection('conversations')
    .doc(conversationId)
    .collection('messages')
    .get()
  const batch = db.batch()
  messagesSnap.docs.forEach((d) => batch.delete(d.ref))
  batch.delete(db.collection('conversations').doc(conversationId))
  await batch.commit()
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd backend && npm run build
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add backend/src/models/api.ts backend/src/services/firestore.ts
git commit -m "feat: add suggestions field to SSE protocol, MessageResponse, and Firestore message storage"
```

---

### Task 3: Update route handler to process StreamItem events

**Files:**
- Modify: `backend/src/routes/conversations.ts`
- Modify: `backend/src/routes/conversations.test.ts`

**Interfaces:**
- Consumes: `StreamItem` from `AIProvider.ts`, updated `db.addMessage` signature from Task 2
- Produces: SSE stream that emits `{ type: 'suggestions', items }` event when AI yields one; assistant messages saved with suggestions to Firestore

- [ ] **Step 1: Update existing tests and add suggestions tests in conversations.test.ts**

In `backend/src/routes/conversations.test.ts`, add the following import at the top (after existing imports):

```typescript
import type { StreamItem } from '../providers/AIProvider'
```

The route handler now calls `db.addMessage(id, 'assistant', content, suggestions)` — always 4 args. Update the two existing `saves full accumulated assistant message` assertions (one in each `describe` block) to include `undefined` as the 4th arg:

Find this line (appears twice, once in each describe block):
```typescript
    expect(firestoreService.addMessage).toHaveBeenCalledWith('conv123', 'assistant', 'Hello world')
```
Replace both with:
```typescript
    expect(firestoreService.addMessage).toHaveBeenCalledWith('conv123', 'assistant', 'Hello world', undefined)
```

Then add these two test cases inside `describe('POST /api/conversations', ...)` after the existing tests:

```typescript
  it('emits suggestions SSE event when AI yields suggestions', async () => {
    async function* stream(): AsyncIterable<StreamItem> {
      yield 'Here are your options:'
      yield { type: 'suggestions', items: ['Yes', 'No'] }
    }
    vi.mocked(mockAI.chatStream).mockReturnValue(stream())
    const res = await request(app)
      .post('/api/conversations')
      .send({ message: 'Give me options' })
      .buffer(true)
    const events = parseSSE(res.text)
    expect(events).toContainEqual({ type: 'suggestions', items: ['Yes', 'No'] })
  })

  it('saves suggestions to Firestore with assistant message', async () => {
    async function* stream(): AsyncIterable<StreamItem> {
      yield 'Choose:'
      yield { type: 'suggestions', items: ['Yes', 'No'] }
    }
    vi.mocked(mockAI.chatStream).mockReturnValue(stream())
    await request(app)
      .post('/api/conversations')
      .send({ message: 'Give me options' })
      .buffer(true)
    expect(firestoreService.addMessage).toHaveBeenCalledWith(
      'conv123', 'assistant', 'Choose:', ['Yes', 'No']
    )
  })
```

Also add these two test cases inside `describe('POST /api/conversations/:id/messages', ...)`:

```typescript
  it('emits suggestions SSE event when AI yields suggestions', async () => {
    async function* stream(): AsyncIterable<StreamItem> {
      yield 'Pick one:'
      yield { type: 'suggestions', items: ['Option A', 'Option B'] }
    }
    vi.mocked(mockAI.chatStream).mockReturnValue(stream())
    const res = await request(app)
      .post('/api/conversations/conv123/messages')
      .send({ message: 'Give me options' })
      .buffer(true)
    const events = parseSSE(res.text)
    expect(events).toContainEqual({ type: 'suggestions', items: ['Option A', 'Option B'] })
  })

  it('saves suggestions to Firestore with assistant message', async () => {
    async function* stream(): AsyncIterable<StreamItem> {
      yield 'Choose:'
      yield { type: 'suggestions', items: ['Option A', 'Option B'] }
    }
    vi.mocked(mockAI.chatStream).mockReturnValue(stream())
    await request(app)
      .post('/api/conversations/conv123/messages')
      .send({ message: 'Give me options' })
      .buffer(true)
    expect(firestoreService.addMessage).toHaveBeenCalledWith(
      'conv123', 'assistant', 'Choose:', ['Option A', 'Option B']
    )
  })
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && npm test -- conversations
```

Expected: 4 new tests FAIL (route handler doesn't handle `StreamItem` union yet).

- [ ] **Step 3: Update conversations.ts to handle StreamItem**

Replace `backend/src/routes/conversations.ts`:

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

      let fullText = ''
      let suggestions: string[] | undefined
      for await (const item of ai.chatStream([], message)) {
        if (typeof item === 'string') {
          fullText += item
          writeSSE(res, { type: 'chunk', text: item })
        } else {
          suggestions = item.items
          writeSSE(res, { type: 'suggestions', items: item.items })
        }
      }
      await db.addMessage(conversationId, 'assistant', fullText, suggestions)
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

      let fullText = ''
      let suggestions: string[] | undefined
      for await (const item of ai.chatStream(aiHistory, message)) {
        if (typeof item === 'string') {
          fullText += item
          writeSSE(res, { type: 'chunk', text: item })
        } else {
          suggestions = item.items
          writeSSE(res, { type: 'suggestions', items: item.items })
        }
      }
      await db.addMessage(id, 'assistant', fullText, suggestions)
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

- [ ] **Step 4: Run all backend tests**

```bash
cd backend && npm test
```

Expected: All tests PASS.

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd backend && npm run build
```

Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/conversations.ts backend/src/routes/conversations.test.ts
git commit -m "feat: handle StreamItem union in route handler and emit suggestions SSE event"
```

---

### Task 4: Update frontend types and API client

**Files:**
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/api.ts`

**Interfaces:**
- Produces: `Message.suggestions?: string[]`, `StreamCallbacks.onSuggestions?: (items: string[]) => void`

- [ ] **Step 1: Update frontend/src/types.ts**

Replace the file:

```typescript
export interface Conversation {
  id: string
  title: string
  lastMessage: string
  updatedAt: string
}

export interface Message {
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  suggestions?: string[]
}
```

- [ ] **Step 2: Update frontend/src/api.ts to handle suggestions SSE event**

Replace the file:

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
  onSuggestions?: (items: string[]) => void
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

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd frontend && npm run build
```

Expected: No errors (ChatPage will have a TypeScript warning about the unused `onSuggestions` prop — that's OK, it will be wired in Task 6).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/types.ts frontend/src/api.ts
git commit -m "feat: add suggestions to Message type and onSuggestions callback to StreamCallbacks"
```

---

### Task 5: Build SuggestionButtons component

**Files:**
- Create: `frontend/src/components/SuggestionButtons.tsx`
- Create: `frontend/src/components/SuggestionButtons.test.tsx`

**Interfaces:**
- Consumes: nothing
- Produces:
  ```typescript
  // SuggestionButtons props
  interface Props {
    items: string[]
    selectedItem?: string   // which button is highlighted (filled blue)
    disabled: boolean       // true = all buttons non-interactive
    onSelect: (item: string) => void
  }
  ```

- [ ] **Step 1: Write failing tests**

Create `frontend/src/components/SuggestionButtons.test.tsx`:

```typescript
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import SuggestionButtons from './SuggestionButtons'

describe('SuggestionButtons', () => {
  it('renders all button labels', () => {
    render(<SuggestionButtons items={['Yes', 'No']} disabled={false} onSelect={() => {}} />)
    expect(screen.getByText('Yes')).toBeInTheDocument()
    expect(screen.getByText('No')).toBeInTheDocument()
  })

  it('calls onSelect with the label when an active button is clicked', () => {
    const onSelect = vi.fn()
    render(<SuggestionButtons items={['Yes', 'No']} disabled={false} onSelect={onSelect} />)
    fireEvent.click(screen.getByText('Yes'))
    expect(onSelect).toHaveBeenCalledWith('Yes')
  })

  it('does not call onSelect when disabled', () => {
    const onSelect = vi.fn()
    render(
      <SuggestionButtons items={['Yes', 'No']} disabled={true} onSelect={onSelect} />
    )
    fireEvent.click(screen.getByText('Yes'))
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('applies filled blue style to selectedItem', () => {
    render(
      <SuggestionButtons
        items={['Yes', 'No']}
        selectedItem="Yes"
        disabled={true}
        onSelect={() => {}}
      />
    )
    expect(screen.getByText('Yes').closest('button')!.className).toContain('bg-[#0084ff]')
  })

  it('applies gray style to non-selected items when disabled', () => {
    render(
      <SuggestionButtons
        items={['Yes', 'No']}
        selectedItem="Yes"
        disabled={true}
        onSelect={() => {}}
      />
    )
    expect(screen.getByText('No').closest('button')!.className).toContain('text-gray-400')
  })

  it('applies blue outline style to all items when not disabled', () => {
    render(
      <SuggestionButtons items={['Yes', 'No']} disabled={false} onSelect={() => {}} />
    )
    expect(screen.getByText('Yes').closest('button')!.className).toContain('text-[#0084ff]')
    expect(screen.getByText('No').closest('button')!.className).toContain('text-[#0084ff]')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd frontend && npm test -- SuggestionButtons
```

Expected: FAIL — `SuggestionButtons` module not found.

- [ ] **Step 3: Implement SuggestionButtons.tsx**

Create `frontend/src/components/SuggestionButtons.tsx`:

```typescript
interface Props {
  items: string[]
  selectedItem?: string
  disabled: boolean
  onSelect: (item: string) => void
}

export default function SuggestionButtons({ items, selectedItem, disabled, onSelect }: Props) {
  return (
    <div className="flex flex-wrap gap-2 mt-1.5 max-w-[80%]">
      {items.map((item) => {
        const isSelected = item === selectedItem
        const isGrayed = disabled && !isSelected
        return (
          <button
            key={item}
            onClick={() => !disabled && onSelect(item)}
            disabled={disabled}
            className={`px-3 py-1 rounded-full text-sm border transition-colors ${
              isSelected
                ? 'bg-[#0084ff] text-white border-[#0084ff] cursor-default'
                : isGrayed
                  ? 'bg-transparent text-gray-400 border-gray-300 cursor-not-allowed'
                  : 'bg-transparent text-[#0084ff] border-[#0084ff] hover:bg-blue-50 cursor-pointer'
            }`}
          >
            {item}
          </button>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd frontend && npm test -- SuggestionButtons
```

Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/SuggestionButtons.tsx frontend/src/components/SuggestionButtons.test.tsx
git commit -m "feat: add SuggestionButtons component"
```

---

### Task 6: Wire up MessageList and ChatPage

**Files:**
- Modify: `frontend/src/components/MessageList.tsx`
- Modify: `frontend/src/components/MessageList.test.tsx`
- Modify: `frontend/src/pages/ChatPage.tsx`

**Interfaces:**
- Consumes: `SuggestionButtons` (props as above), `Message.suggestions?: string[]`, `StreamCallbacks.onSuggestions`
- Produces: fully wired feature — buttons rendered below assistant messages, click sends as user message

- [ ] **Step 1: Add MessageList tests for suggestion buttons**

Replace `frontend/src/components/MessageList.test.tsx`:

```typescript
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import MessageList from './MessageList'
import type { Message } from '../types'

function msg(role: 'user' | 'assistant', content: string, suggestions?: string[]): Message {
  return { role, content, createdAt: new Date().toISOString(), suggestions }
}

describe('MessageList', () => {
  it('renders markdown for assistant messages', () => {
    render(<MessageList messages={[msg('assistant', '**bold**')]} />)
    expect(screen.getByText('bold').tagName).toBe('STRONG')
  })

  it('does not render markdown for user messages', () => {
    render(<MessageList messages={[msg('user', '**bold**')]} />)
    expect(screen.queryByText('bold')).toBeNull()
    expect(screen.getByText('**bold**')).toBeInTheDocument()
  })

  it('renders suggestion buttons below an assistant message', () => {
    render(
      <MessageList
        messages={[msg('assistant', 'Choose one:', ['Yes', 'No'])]}
        onSuggestionClick={() => {}}
      />
    )
    expect(screen.getByText('Yes')).toBeInTheDocument()
    expect(screen.getByText('No')).toBeInTheDocument()
  })

  it('does not render suggestion buttons for messages without suggestions', () => {
    render(<MessageList messages={[msg('assistant', 'Hello')]} onSuggestionClick={() => {}} />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('calls onSuggestionClick when an active button is clicked', () => {
    const onSuggestionClick = vi.fn()
    render(
      <MessageList
        messages={[msg('assistant', 'Choose:', ['Yes', 'No'])]}
        onSuggestionClick={onSuggestionClick}
      />
    )
    fireEvent.click(screen.getByText('Yes'))
    expect(onSuggestionClick).toHaveBeenCalledWith('Yes')
  })

  it('marks the matching button as selected when next message matches a suggestion', () => {
    render(
      <MessageList
        messages={[
          msg('assistant', 'Choose:', ['Yes', 'No']),
          msg('user', 'Yes'),
        ]}
        onSuggestionClick={() => {}}
      />
    )
    expect(screen.getByText('Yes').closest('button')!.className).toContain('bg-[#0084ff]')
    expect(screen.getByText('No').closest('button')!.className).toContain('text-gray-400')
  })

  it('grays out all buttons when next user message does not match any suggestion', () => {
    render(
      <MessageList
        messages={[
          msg('assistant', 'Choose:', ['Yes', 'No']),
          msg('user', 'Something else entirely'),
        ]}
        onSuggestionClick={() => {}}
      />
    )
    expect(screen.getByText('Yes').closest('button')!.className).toContain('text-gray-400')
    expect(screen.getByText('No').closest('button')!.className).toContain('text-gray-400')
  })
})
```

- [ ] **Step 2: Run tests to verify new tests fail**

```bash
cd frontend && npm test -- MessageList
```

Expected: 5 new tests FAIL (MessageList doesn't accept `onSuggestionClick` or render suggestions yet).

- [ ] **Step 3: Update MessageList.tsx**

Replace `frontend/src/components/MessageList.tsx`:

```typescript
import { useEffect, useRef } from 'react'
import type { Message } from '../types'
import MarkdownMessage from './MarkdownMessage'
import SuggestionButtons from './SuggestionButtons'

interface Props {
  messages: Message[]
  onSuggestionClick?: (text: string) => void
}

export default function MessageList({ messages, onSuggestionClick }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  return (
    <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
      {messages.map((m, i) => {
        const nextMsg = messages[i + 1]
        const hasFollowUp = nextMsg?.role === 'user'
        const selectedItem =
          hasFollowUp && m.suggestions?.includes(nextMsg.content)
            ? nextMsg.content
            : undefined

        return (
          <div
            key={i}
            className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}
          >
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

- [ ] **Step 4: Run MessageList tests to verify they pass**

```bash
cd frontend && npm test -- MessageList
```

Expected: All 7 tests PASS.

- [ ] **Step 5: Update ChatPage.tsx to handle onSuggestions and pass onSuggestionClick**

Replace `frontend/src/pages/ChatPage.tsx`:

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

interface Props {
  user: User
}

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
        <MessageList messages={messages} onSuggestionClick={handleSend} />
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

- [ ] **Step 6: Run all frontend tests**

```bash
cd frontend && npm test
```

Expected: All tests PASS.

- [ ] **Step 7: Verify TypeScript compiles**

```bash
cd frontend && npm run build
```

Expected: No errors.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/MessageList.tsx frontend/src/components/MessageList.test.tsx frontend/src/pages/ChatPage.tsx
git commit -m "feat: render suggestion buttons in MessageList and wire up ChatPage"
```
