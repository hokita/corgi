# Brainstorming Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `brainstorm_ideas` Gemini function call tool that renders idea clusters as cards in the chat UI, with cluster labels automatically becoming suggestion buttons.

**Architecture:** A new `brainstormIdeasTool` function declaration is added alongside `suggestOptionsTool` in `GeminiProvider`. When the AI calls it, the backend emits a `brainstorm` SSE event and persists clusters to Firestore. The frontend parses the event, stores clusters on the message, and renders `BrainstormClusters` cards above the suggestion buttons.

**Tech Stack:** TypeScript, Express, Gemini SDK (`@google/generative-ai`), React, Tailwind CSS, Vitest, Firestore (firebase-admin)

## Global Constraints

- All backend TypeScript must compile with `tsc` (no errors)
- All backend tests must pass: `cd backend && npm test`
- All frontend TypeScript must compile: `cd frontend && npm run build`
- All frontend tests must pass: `cd frontend && npm test`
- `IdeaCluster` shape: `{ label: string; ideas: { label: string; description: string }[] }`
- `brainstorm_ideas` takes priority over `suggest_options` if both are called in the same turn
- If `brainstorm_ideas` args are malformed (missing/invalid clusters), silently skip — no crash

---

## File Map

**Backend — create/modify:**
- Modify: `backend/src/models/api.ts` — export `IdeaCluster` type; add `brainstorm` to `SSEEvent`
- Modify: `backend/src/providers/AIProvider.ts` — add `brainstorm` variant to `StreamItem`
- Modify: `backend/src/providers/GeminiProvider.ts` — add `brainstormIdeasTool`, handle `brainstorm_ideas` call, update system instruction
- Modify: `backend/src/providers/GeminiProvider.test.ts` — add brainstorm test cases
- Modify: `backend/src/services/firestore.ts` — add `clusters` to `FirestoreMessage`, `addMessage`, `getMessages`
- Modify: `backend/src/routes/conversations.ts` — handle `brainstorm` StreamItem, persist clusters
- Modify: `backend/src/routes/conversations.test.ts` — add brainstorm tests; update `addMessage` assertions

**Frontend — create/modify:**
- Modify: `frontend/src/types.ts` — export `IdeaCluster`; add `clusters` to `Message`
- Modify: `frontend/src/api.ts` — add `onBrainstorm` to `StreamCallbacks`; parse `brainstorm` SSE event
- Modify: `frontend/src/api.test.ts` — add `onBrainstorm` test
- Create: `frontend/src/components/BrainstormClusters.tsx` — renders cluster cards
- Create: `frontend/src/components/BrainstormClusters.test.tsx` — component tests
- Modify: `frontend/src/components/MessageList.tsx` — render `BrainstormClusters` above `SuggestionButtons`
- Modify: `frontend/src/components/MessageList.test.tsx` — add cluster rendering tests
- Modify: `frontend/src/pages/ChatPage.tsx` — wire `onBrainstorm` callback

---

## Task 1: Backend type definitions

**Files:**
- Modify: `backend/src/models/api.ts`
- Modify: `backend/src/providers/AIProvider.ts`

**Interfaces:**
- Produces: `IdeaCluster` exported from `models/api.ts` — used by Tasks 2, 3, 4
- Produces: `StreamItem` union with `brainstorm` variant in `AIProvider.ts` — used by Tasks 2, 3

- [ ] **Step 1: Add `IdeaCluster` and `brainstorm` SSE event to `models/api.ts`**

Replace the entire file content:

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
  clusters?: IdeaCluster[]
}

export interface IdeaCluster {
  label: string
  ideas: { label: string; description: string }[]
}

// SSE event types for POST /api/conversations and POST /api/conversations/:id/messages
export type SSEEvent =
  | { type: 'meta'; conversationId: string; title: string }
  | { type: 'chunk'; text: string }
  | { type: 'suggestions'; items: string[] }
  | { type: 'brainstorm'; clusters: IdeaCluster[] }
  | { type: 'done' }
  | { type: 'error'; message: string }

// Error response (all non-SSE endpoints)
export interface ErrorResponse {
  error: string
}
```

- [ ] **Step 2: Add `brainstorm` variant to `StreamItem` in `AIProvider.ts`**

Replace the entire file content:

```ts
import type { IdeaCluster } from '../models/api'

export interface Message {
  role: 'user' | 'assistant'
  content: string
}

export type StreamItem =
  | string
  | { type: 'suggestions'; items: string[] }
  | { type: 'brainstorm'; clusters: IdeaCluster[] }

export interface AIProvider {
  chatStream(history: Message[], newMessage: string): AsyncIterable<StreamItem>
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd /path/to/corgi/backend && npm run build`
Expected: no output (clean compile)

- [ ] **Step 4: Commit**

```bash
git add backend/src/models/api.ts backend/src/providers/AIProvider.ts
git commit -m "feat: add IdeaCluster type and brainstorm StreamItem/SSEEvent"
```

---

## Task 2: GeminiProvider — brainstorm_ideas tool

**Files:**
- Modify: `backend/src/providers/GeminiProvider.ts`
- Modify: `backend/src/providers/GeminiProvider.test.ts`

**Interfaces:**
- Consumes: `IdeaCluster` from `../models/api`; `StreamItem` with `brainstorm` variant from `./AIProvider`
- Produces: `chatStream` that yields `{ type: 'brainstorm', clusters }` and `{ type: 'suggestions', items: clusterLabels }` when AI calls `brainstorm_ideas`

- [ ] **Step 1: Write the failing tests in `GeminiProvider.test.ts`**

Add these two test cases inside the `describe('GeminiProvider', ...)` block (after the existing tests):

```ts
it('yields brainstorm and suggestions items when Gemini calls brainstorm_ideas', async () => {
  const clusters = [
    { label: 'Cluster A', ideas: [{ label: 'Idea 1', description: 'Desc 1' }] },
    { label: 'Cluster B', ideas: [{ label: 'Idea 2', description: 'Desc 2' }] },
  ]
  async function* fakeStream() {
    yield { text: () => 'Here are your ideas.', candidates: undefined }
    yield {
      text: () => '',
      candidates: [
        {
          content: {
            parts: [{ functionCall: { name: 'brainstorm_ideas', args: { clusters } } }],
          },
        },
      ],
    }
  }
  mockSendMessageStream.mockResolvedValue({ stream: fakeStream() })
  const provider = new GeminiProvider('fake-key')
  const items = await collectStream(provider.chatStream([], 'Help me brainstorm'))
  expect(items).toEqual([
    'Here are your ideas.',
    { type: 'brainstorm', clusters },
    { type: 'suggestions', items: ['Cluster A', 'Cluster B'] },
  ])
})

it('ignores suggest_options when brainstorm_ideas was already called', async () => {
  const clusters = [
    { label: 'Cluster A', ideas: [{ label: 'Idea 1', description: 'Desc 1' }] },
  ]
  async function* fakeStream() {
    yield {
      text: () => '',
      candidates: [
        {
          content: {
            parts: [{ functionCall: { name: 'brainstorm_ideas', args: { clusters } } }],
          },
        },
      ],
    }
    yield {
      text: () => '',
      candidates: [
        {
          content: {
            parts: [{ functionCall: { name: 'suggest_options', args: { items: ['Extra', 'Button'] } } }],
          },
        },
      ],
    }
  }
  mockSendMessageStream.mockResolvedValue({ stream: fakeStream() })
  const provider = new GeminiProvider('fake-key')
  const items = await collectStream(provider.chatStream([], 'Brainstorm'))
  expect(items).toEqual([
    { type: 'brainstorm', clusters },
    { type: 'suggestions', items: ['Cluster A'] },
  ])
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /path/to/corgi/backend && npm test -- --reporter=verbose 2>&1 | grep -E 'brainstorm|FAIL|PASS'`
Expected: 2 new tests fail with something like "brainstorm_ideas is not handled"

- [ ] **Step 3: Implement `brainstormIdeasTool` and update `GeminiProvider.ts`**

Replace the entire file content:

```ts
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai'
import type { IdeaCluster } from '../models/api'
import type { AIProvider, Message, StreamItem } from './AIProvider'

const suggestOptionsTool = {
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
  ],
}

const brainstormIdeasTool = {
  functionDeclarations: [
    {
      name: 'brainstorm_ideas',
      description:
        'Call when the user is exploring, generating, or brainstorming ideas. Do NOT call for factual questions, weather, or conversational messages.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          clusters: {
            type: SchemaType.ARRAY,
            items: {
              type: SchemaType.OBJECT,
              properties: {
                label: { type: SchemaType.STRING },
                ideas: {
                  type: SchemaType.ARRAY,
                  items: {
                    type: SchemaType.OBJECT,
                    properties: {
                      label: { type: SchemaType.STRING },
                      description: { type: SchemaType.STRING },
                    },
                    required: ['label', 'description'],
                  },
                },
              },
              required: ['label', 'ideas'],
            },
            description: '2 to 4 clusters of related ideas, each with 2 to 4 ideas',
          },
        },
        required: ['clusters'],
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
      model: 'gemini-3.5-flash',
      systemInstruction:
        'You are a helpful assistant. When the user is exploring, generating, or brainstorming ideas, call `brainstorm_ideas` with 2–4 clusters of related ideas (2–4 ideas each). When it would help the user choose a next step, call `suggest_options` at the end of your response with 2 to 4 short button labels.',
    })
  }

  async *chatStream(history: Message[], newMessage: string): AsyncIterable<StreamItem> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tools: any[] = [suggestOptionsTool, brainstormIdeasTool]
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

    let hasBrainstorm = false

    for await (const chunk of result.stream) {
      let hasFunctionCall = false
      for (const candidate of chunk.candidates ?? []) {
        for (const part of candidate.content?.parts ?? []) {
          if ('functionCall' in part) {
            const { name, args } = part.functionCall as { name: string; args: unknown }
            if (name === 'brainstorm_ideas') {
              hasFunctionCall = true
              hasBrainstorm = true
              const clusters = (args as { clusters?: IdeaCluster[] }).clusters
              if (Array.isArray(clusters) && clusters.length > 0) {
                yield { type: 'brainstorm', clusters }
                yield { type: 'suggestions', items: clusters.map((c) => c.label) }
              }
            } else if (name === 'suggest_options') {
              hasFunctionCall = true
              if (!hasBrainstorm) {
                const items = (args as { items?: string[] }).items
                if (Array.isArray(items) && items.length > 0) {
                  yield { type: 'suggestions', items }
                }
              }
            }
          }
        }
      }
      if (!hasFunctionCall) {
        const text = chunk.text()
        if (text) yield text
      }
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /path/to/corgi/backend && npm test`
Expected: all 31 tests pass (29 existing + 2 new)

- [ ] **Step 5: Commit**

```bash
git add backend/src/providers/GeminiProvider.ts backend/src/providers/GeminiProvider.test.ts
git commit -m "feat: add brainstorm_ideas function call tool to GeminiProvider"
```

---

## Task 3: Firestore persistence + conversations route

**Files:**
- Modify: `backend/src/services/firestore.ts`
- Modify: `backend/src/routes/conversations.ts`
- Modify: `backend/src/routes/conversations.test.ts`

**Interfaces:**
- Consumes: `IdeaCluster` from `../models/api`; `StreamItem` with `brainstorm` variant from `../providers/AIProvider`
- Produces: `addMessage(conversationId, role, content, suggestions?, clusters?)` — 5th arg is optional clusters
- Produces: `FirestoreMessage` with optional `clusters` field

- [ ] **Step 1: Write the failing tests in `conversations.test.ts`**

First, update the 4 existing `addMessage` assertions to include the new 5th argument. Find these lines and update them:

```ts
// In "saves full accumulated assistant message to Firestore" (POST /):
// OLD:
expect(firestoreService.addMessage).toHaveBeenCalledWith('conv123', 'assistant', 'Hello world', undefined)
// NEW:
expect(firestoreService.addMessage).toHaveBeenCalledWith('conv123', 'assistant', 'Hello world', undefined, undefined)

// In "saves suggestions to Firestore with assistant message" (POST /):
// OLD:
expect(firestoreService.addMessage).toHaveBeenCalledWith(
  'conv123', 'assistant', 'Choose:', ['Yes', 'No']
)
// NEW:
expect(firestoreService.addMessage).toHaveBeenCalledWith(
  'conv123', 'assistant', 'Choose:', ['Yes', 'No'], undefined
)

// In "saves full accumulated assistant message to Firestore" (POST /:id/messages):
// OLD:
expect(firestoreService.addMessage).toHaveBeenCalledWith('conv123', 'assistant', 'Hello world', undefined)
// NEW:
expect(firestoreService.addMessage).toHaveBeenCalledWith('conv123', 'assistant', 'Hello world', undefined, undefined)

// In "saves suggestions to Firestore with assistant message" (POST /:id/messages):
// OLD:
expect(firestoreService.addMessage).toHaveBeenCalledWith(
  'conv123', 'assistant', 'Choose:', ['Option A', 'Option B']
)
// NEW:
expect(firestoreService.addMessage).toHaveBeenCalledWith(
  'conv123', 'assistant', 'Choose:', ['Option A', 'Option B'], undefined
)
```

Then add these new test cases inside `describe('POST /api/conversations', ...)`:

```ts
it('emits brainstorm SSE event when AI yields brainstorm', async () => {
  const clusters = [{ label: 'Cluster A', ideas: [{ label: 'Idea', description: 'Desc' }] }]
  async function* stream(): AsyncIterable<StreamItem> {
    yield { type: 'brainstorm', clusters }
  }
  vi.mocked(mockAI.chatStream).mockReturnValue(stream())
  const res = await request(app)
    .post('/api/conversations')
    .send({ message: 'Brainstorm ideas' })
    .buffer(true)
  const events = parseSSE(res.text)
  expect(events).toContainEqual({ type: 'brainstorm', clusters })
})

it('saves clusters to Firestore with assistant message', async () => {
  const clusters = [{ label: 'Cluster A', ideas: [{ label: 'Idea', description: 'Desc' }] }]
  async function* stream(): AsyncIterable<StreamItem> {
    yield { type: 'brainstorm', clusters }
  }
  vi.mocked(mockAI.chatStream).mockReturnValue(stream())
  await request(app)
    .post('/api/conversations')
    .send({ message: 'Brainstorm ideas' })
    .buffer(true)
  expect(firestoreService.addMessage).toHaveBeenCalledWith(
    'conv123', 'assistant', '', undefined, clusters
  )
})
```

- [ ] **Step 2: Run tests to verify the new ones fail and the updated assertions work**

Run: `cd /path/to/corgi/backend && npm test -- --reporter=verbose 2>&1 | grep -E 'brainstorm|addMessage|FAIL|PASS'`
Expected: 2 new brainstorm tests fail; existing addMessage tests should pass (they were just updated)

- [ ] **Step 3: Update `firestore.ts` to support clusters**

Replace the entire file content:

```ts
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import type { IdeaCluster } from '../models/api'

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
  clusters?: IdeaCluster[]
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
  suggestions?: string[],
  clusters?: IdeaCluster[]
): Promise<void> {
  const db = getFirestore()
  const data: Record<string, unknown> = { role, content, createdAt: Timestamp.now() }
  if (suggestions && suggestions.length > 0) data.suggestions = suggestions
  if (clusters && clusters.length > 0) data.clusters = clusters
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
    if (Array.isArray(data.clusters)) msg.clusters = data.clusters as IdeaCluster[]
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

- [ ] **Step 4: Update `conversations.ts` to handle `brainstorm` StreamItem**

The two route handlers (POST `/` and POST `/:id/messages`) each need the same change. In both handlers, replace the stream-processing block:

Current pattern (appears twice):
```ts
let fullText = ''
let suggestions: string[] | undefined
for await (const item of ai.chatStream(...)) {
  if (typeof item === 'string') {
    fullText += item
    writeSSE(res, { type: 'chunk', text: item })
  } else {
    suggestions = item.items
    writeSSE(res, { type: 'suggestions', items: item.items })
  }
}
await db.addMessage(conversationId, 'assistant', fullText, suggestions)
```

New pattern (apply to both handlers):
```ts
let fullText = ''
let suggestions: string[] | undefined
let clusters: import('../models/api').IdeaCluster[] | undefined
for await (const item of ai.chatStream(...)) {
  if (typeof item === 'string') {
    fullText += item
    writeSSE(res, { type: 'chunk', text: item })
  } else if (item.type === 'brainstorm') {
    clusters = item.clusters
    writeSSE(res, { type: 'brainstorm', clusters: item.clusters })
  } else if (item.type === 'suggestions') {
    suggestions = item.items
    writeSSE(res, { type: 'suggestions', items: item.items })
  }
}
await db.addMessage(conversationId, 'assistant', fullText, suggestions, clusters)
```

Note: the first handler uses `conversationId` (from the `createConversation` call); the second uses `id` (from `req.params`). Replace accordingly.

Also add the import at the top of `conversations.ts`:
```ts
import type { IdeaCluster } from '../models/api'
```

The full updated `conversations.ts`:

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
  IdeaCluster,
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
      let clusters: IdeaCluster[] | undefined
      for await (const item of ai.chatStream([], message)) {
        if (typeof item === 'string') {
          fullText += item
          writeSSE(res, { type: 'chunk', text: item })
        } else if (item.type === 'brainstorm') {
          clusters = item.clusters
          writeSSE(res, { type: 'brainstorm', clusters: item.clusters })
        } else if (item.type === 'suggestions') {
          suggestions = item.items
          writeSSE(res, { type: 'suggestions', items: item.items })
        }
      }
      await db.addMessage(conversationId, 'assistant', fullText, suggestions, clusters)
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
      let clusters: IdeaCluster[] | undefined
      for await (const item of ai.chatStream(aiHistory, message)) {
        if (typeof item === 'string') {
          fullText += item
          writeSSE(res, { type: 'chunk', text: item })
        } else if (item.type === 'brainstorm') {
          clusters = item.clusters
          writeSSE(res, { type: 'brainstorm', clusters: item.clusters })
        } else if (item.type === 'suggestions') {
          suggestions = item.items
          writeSSE(res, { type: 'suggestions', items: item.items })
        }
      }
      await db.addMessage(id, 'assistant', fullText, suggestions, clusters)
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

- [ ] **Step 5: Run all backend tests to verify they pass**

Run: `cd /path/to/corgi/backend && npm test`
Expected: all 33 tests pass (31 from Task 2 + 2 new brainstorm route tests)

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/firestore.ts backend/src/routes/conversations.ts backend/src/routes/conversations.test.ts
git commit -m "feat: persist and stream brainstorm clusters in conversations route"
```

---

## Task 4: Frontend types and api.ts

**Files:**
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/api.ts`
- Modify: `frontend/src/api.test.ts`

**Interfaces:**
- Produces: `IdeaCluster` exported from `types.ts` — used by Tasks 5, 6, 7, 8
- Produces: `Message.clusters?: IdeaCluster[]` — used by Tasks 6, 7, 8
- Produces: `StreamCallbacks.onBrainstorm?: (clusters: IdeaCluster[]) => void` — used by Task 8

- [ ] **Step 1: Write the failing test in `api.test.ts`**

Add this test case inside a new `describe` block at the end of the file:

```ts
describe('api brainstorm SSE event', () => {
  it('calls onBrainstorm when brainstorm event received', async () => {
    const clusters = [{ label: 'Cluster A', ideas: [{ label: 'Idea', description: 'Desc' }] }]
    mockStreamResponse([
      { type: 'brainstorm', clusters },
      { type: 'done' },
    ])
    const onBrainstorm = vi.fn()
    const onChunk = vi.fn()
    const onDone = vi.fn()
    const onError = vi.fn()
    await api.sendMessage('c1', 'Brainstorm', { onBrainstorm, onChunk, onDone, onError })
    expect(onBrainstorm).toHaveBeenCalledWith(clusters)
    expect(onDone).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /path/to/corgi/frontend && npm test -- --reporter=verbose 2>&1 | grep -E 'brainstorm|FAIL|PASS'`
Expected: 1 new test fails

- [ ] **Step 3: Update `types.ts`**

Replace the entire file:

```ts
export interface IdeaCluster {
  label: string
  ideas: { label: string; description: string }[]
}

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
  clusters?: IdeaCluster[]
}
```

- [ ] **Step 4: Update `api.ts` to parse `brainstorm` SSE event**

Replace the entire file:

```ts
import { auth } from './firebase'
import type { Conversation, Message, IdeaCluster } from './types'

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
  onBrainstorm?: (clusters: IdeaCluster[]) => void
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
        clusters?: IdeaCluster[]
      }
      if (event.type === 'chunk') callbacks.onChunk(event.text!)
      else if (event.type === 'meta')
        callbacks.onMeta?.({ conversationId: event.conversationId!, title: event.title! })
      else if (event.type === 'suggestions') callbacks.onSuggestions?.(event.items!)
      else if (event.type === 'brainstorm') callbacks.onBrainstorm?.(event.clusters!)
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

- [ ] **Step 5: Run frontend tests to verify they pass**

Run: `cd /path/to/corgi/frontend && npm test`
Expected: all tests pass including the new brainstorm test

- [ ] **Step 6: Commit**

```bash
git add frontend/src/types.ts frontend/src/api.ts frontend/src/api.test.ts
git commit -m "feat: add IdeaCluster type and onBrainstorm SSE callback to frontend"
```

---

## Task 5: BrainstormClusters component

**Files:**
- Create: `frontend/src/components/BrainstormClusters.tsx`
- Create: `frontend/src/components/BrainstormClusters.test.tsx`

**Interfaces:**
- Consumes: `IdeaCluster` from `../types`
- Produces: `BrainstormClusters({ clusters: IdeaCluster[] })` — used by Task 6

- [ ] **Step 1: Write the failing tests in `BrainstormClusters.test.tsx`**

Create the file:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import BrainstormClusters from './BrainstormClusters'
import type { IdeaCluster } from '../types'

const clusters: IdeaCluster[] = [
  {
    label: 'Product Ideas',
    ideas: [
      { label: 'Subscription box', description: 'Curated monthly delivery targeting hobbyists' },
      { label: 'Mobile app', description: 'On-demand access with push notifications' },
    ],
  },
  {
    label: 'Marketing',
    ideas: [
      { label: 'Social media', description: 'Instagram campaigns targeting Gen Z' },
    ],
  },
]

describe('BrainstormClusters', () => {
  it('renders cluster labels as headings', () => {
    render(<BrainstormClusters clusters={clusters} />)
    expect(screen.getByText('Product Ideas')).toBeInTheDocument()
    expect(screen.getByText('Marketing')).toBeInTheDocument()
  })

  it('renders idea labels', () => {
    render(<BrainstormClusters clusters={clusters} />)
    expect(screen.getByText('Subscription box')).toBeInTheDocument()
    expect(screen.getByText('Mobile app')).toBeInTheDocument()
    expect(screen.getByText('Social media')).toBeInTheDocument()
  })

  it('renders idea descriptions', () => {
    render(<BrainstormClusters clusters={clusters} />)
    expect(screen.getByText('Curated monthly delivery targeting hobbyists')).toBeInTheDocument()
    expect(screen.getByText('Instagram campaigns targeting Gen Z')).toBeInTheDocument()
  })

  it('renders nothing for empty clusters array', () => {
    const { container } = render(<BrainstormClusters clusters={[]} />)
    expect(container.firstChild).toBeEmptyDOMElement()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /path/to/corgi/frontend && npm test -- --reporter=verbose 2>&1 | grep -E 'BrainstormClusters|FAIL|PASS'`
Expected: 4 tests fail with "Cannot find module"

- [ ] **Step 3: Create `BrainstormClusters.tsx`**

```tsx
import type { IdeaCluster } from '../types'

interface Props {
  clusters: IdeaCluster[]
}

export default function BrainstormClusters({ clusters }: Props) {
  return (
    <div className="flex flex-col gap-3 mt-1.5 max-w-[80%]">
      {clusters.map((cluster) => (
        <div key={cluster.label} className="bg-white border border-gray-200 rounded-xl p-3">
          <div className="font-semibold text-sm text-gray-900 mb-2">{cluster.label}</div>
          <div className="flex flex-col gap-1.5">
            {cluster.ideas.map((idea) => (
              <div key={idea.label} className="text-sm text-gray-700">
                <span className="font-medium">{idea.label}</span>
                {' — '}
                <span>{idea.description}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /path/to/corgi/frontend && npm test`
Expected: all tests pass including 4 new BrainstormClusters tests

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/BrainstormClusters.tsx frontend/src/components/BrainstormClusters.test.tsx
git commit -m "feat: add BrainstormClusters component"
```

---

## Task 6: MessageList — render BrainstormClusters

**Files:**
- Modify: `frontend/src/components/MessageList.tsx`
- Modify: `frontend/src/components/MessageList.test.tsx`

**Interfaces:**
- Consumes: `BrainstormClusters` from `./BrainstormClusters`; `IdeaCluster` from `../types`
- Produces: renders `BrainstormClusters` above `SuggestionButtons` when message has `clusters`

- [ ] **Step 1: Write failing tests in `MessageList.test.tsx`**

Update the helper at the top of the file to support clusters:

```ts
function msg(role: 'user' | 'assistant', content: string, suggestions?: string[]): Message {
  return { role, content, createdAt: new Date().toISOString(), suggestions }
}
```

Add this import at the top:
```ts
import type { IdeaCluster } from '../types'
```

Add these test cases inside the `describe('MessageList', ...)` block:

```ts
it('renders BrainstormClusters when message has clusters', () => {
  const clusters: IdeaCluster[] = [
    { label: 'Cluster A', ideas: [{ label: 'Idea 1', description: 'Desc 1' }] },
  ]
  render(
    <MessageList
      messages={[{ role: 'assistant', content: 'Here are ideas:', createdAt: '', clusters }]}
      onSuggestionClick={() => {}}
    />
  )
  expect(screen.getByText('Cluster A')).toBeInTheDocument()
  expect(screen.getByText('Idea 1')).toBeInTheDocument()
  expect(screen.getByText('Desc 1')).toBeInTheDocument()
})

it('renders BrainstormClusters above SuggestionButtons when both present', () => {
  const clusters: IdeaCluster[] = [
    { label: 'Cluster A', ideas: [{ label: 'Idea 1', description: 'Desc 1' }] },
  ]
  render(
    <MessageList
      messages={[
        {
          role: 'assistant',
          content: '',
          createdAt: '',
          clusters,
          suggestions: ['Cluster A'],
        },
      ]}
      onSuggestionClick={() => {}}
    />
  )
  expect(screen.getByText('Cluster A')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Cluster A' })).toBeInTheDocument()
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /path/to/corgi/frontend && npm test -- --reporter=verbose 2>&1 | grep -E 'MessageList|FAIL|PASS'`
Expected: 2 new tests fail

- [ ] **Step 3: Update `MessageList.tsx` to render BrainstormClusters**

Replace the entire file:

```tsx
import { useEffect, useRef } from 'react'
import type { Message } from '../types'
import MarkdownMessage from './MarkdownMessage'
import SuggestionButtons from './SuggestionButtons'
import BrainstormClusters from './BrainstormClusters'

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
            {m.role === 'assistant' && m.clusters && m.clusters.length > 0 && (
              <BrainstormClusters clusters={m.clusters} />
            )}
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /path/to/corgi/frontend && npm test`
Expected: all tests pass including 2 new MessageList tests

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/MessageList.tsx frontend/src/components/MessageList.test.tsx
git commit -m "feat: render BrainstormClusters in MessageList"
```

---

## Task 7: ChatPage — wire onBrainstorm callback

**Files:**
- Modify: `frontend/src/pages/ChatPage.tsx`

**Interfaces:**
- Consumes: `IdeaCluster` from `../types`; `StreamCallbacks.onBrainstorm` from `../api`

- [ ] **Step 1: Update `ChatPage.tsx`**

Add `IdeaCluster` to the import from `../types`:
```ts
import type { Conversation, Message, IdeaCluster } from '../types'
```

Add an `onBrainstorm` handler alongside `onSuggestions` in `handleSend`:

```ts
const onBrainstorm = (clusters: IdeaCluster[]) => {
  setMessages((prev) => {
    const msgs = [...prev]
    msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], clusters }
    return msgs
  })
}
```

Wire `onBrainstorm` into both `api.createConversation` and `api.sendMessage` calls (add it alongside `onSuggestions`):

```ts
// In createConversation call:
await api.createConversation(text, {
  onMeta: ...,
  onChunk: ...,
  onSuggestions,
  onBrainstorm,
  onDone: ...,
  onError,
})

// In sendMessage call:
await api.sendMessage(id, text, {
  onChunk: ...,
  onSuggestions,
  onBrainstorm,
  onDone: ...,
  onError,
})
```

The full updated `ChatPage.tsx`:

```tsx
import { useState, useEffect, useCallback } from 'react'
import { signOut } from 'firebase/auth'
import type { User } from 'firebase/auth'
import { auth } from '../firebase'
import { api } from '../api'
import type { Conversation, Message, IdeaCluster } from '../types'
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
    if (sending) return
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

    const onBrainstorm = (clusters: IdeaCluster[]) => {
      setMessages((prev) => {
        const msgs = [...prev]
        msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], clusters }
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
          onBrainstorm,
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
          onBrainstorm,
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

- [ ] **Step 2: Run full frontend test suite and build**

Run: `cd /path/to/corgi/frontend && npm test && npm run build`
Expected: all tests pass, build succeeds with no TypeScript errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/ChatPage.tsx
git commit -m "feat: wire onBrainstorm callback in ChatPage"
```

- [ ] **Step 4: Push and verify deploy**

```bash
git push
gh run watch $(gh run list --limit 1 --repo hokita/corgi --json databaseId --jq '.[0].databaseId') --repo hokita/corgi
```
Expected: deploy job completes successfully
