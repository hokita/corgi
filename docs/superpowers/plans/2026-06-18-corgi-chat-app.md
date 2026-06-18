# Corgi — Personal AI Chat App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a mobile-first PWA chat app with Google login, Firestore storage, and Gemini AI, deployed to Firebase Hosting + Cloud Run.

**Architecture:** Express backend on Cloud Run handles auth (Firebase token verification + email allowlist), calls Gemini with full conversation history, and reads/writes Firestore. React PWA frontend uses Firebase Auth for Google login and attaches the ID token to every API request.

**Tech Stack:** React 18 + Vite + TypeScript + vite-plugin-pwa + react-router-dom (frontend); Node.js + Express + TypeScript + firebase-admin + @google/generative-ai (backend); Firebase Auth + Firestore + Hosting (GCP); vitest + supertest (tests)

---

## File Structure

### `/backend`
| File | Responsibility |
|------|----------------|
| `package.json` | deps + scripts |
| `tsconfig.json` | TypeScript config |
| `vitest.config.ts` | test runner config (node env) |
| `Dockerfile` | container image |
| `.env.example` | env var template |
| `src/index.ts` | Firebase Admin init + server startup |
| `src/app.ts` | Express app factory (exported for tests) |
| `src/middleware/auth.ts` | Token verification + email allowlist |
| `src/middleware/auth.test.ts` | Auth middleware tests |
| `src/providers/AIProvider.ts` | AIProvider interface + Message type |
| `src/providers/GeminiProvider.ts` | Gemini SDK implementation |
| `src/providers/GeminiProvider.test.ts` | GeminiProvider tests |
| `src/services/firestore.ts` | Firestore CRUD helpers |
| `src/routes/conversations.ts` | All 5 conversation endpoints |
| `src/routes/conversations.test.ts` | Route integration tests |

### `/frontend`
| File | Responsibility |
|------|----------------|
| `package.json` | deps + scripts |
| `tsconfig.json` | TypeScript config |
| `vite.config.ts` | Vite + PWA plugin config |
| `.env.example` | env var template |
| `index.html` | HTML entry point |
| `public/icon-192.png` | PWA icon 192×192 |
| `public/icon-512.png` | PWA icon 512×512 |
| `src/main.tsx` | React entry |
| `src/App.tsx` | Router + auth gate |
| `src/firebase.ts` | Firebase client init |
| `src/api.ts` | Typed API client (fetch + auth token) |
| `src/api.test.ts` | API client unit tests |
| `src/types.ts` | Conversation + Message types |
| `src/test-setup.ts` | vitest + testing-library setup |
| `src/pages/LoginPage.tsx` | Google sign-in screen |
| `src/pages/ChatPage.tsx` | Chat screen + state management |
| `src/components/MessageList.tsx` | Renders message bubbles |
| `src/components/MessageInput.tsx` | Text input + send button |
| `src/components/HistoryDrawer.tsx` | Slide-in conversation list overlay |

---

### Task 1: Firebase project prerequisites

**Files:** none (manual setup)

- [ ] **Step 1: Create Firebase project**

  Go to https://console.firebase.google.com → "Add project" → name it `corgi` → disable Google Analytics → Create.

- [ ] **Step 2: Enable Google Authentication**

  Firebase console → Authentication → Get started → Sign-in method → Google → Enable → set support email → Save.

- [ ] **Step 3: Create Firestore database**

  Firebase console → Firestore Database → Create database → Start in **test mode** → choose a region close to you → Done.

- [ ] **Step 4: Get Firebase web config**

  Firebase console → Project settings (gear icon) → General → Your apps → "Add app" → Web → register with nickname `corgi-frontend` → copy the `firebaseConfig` object. You'll need it in Task 10.

- [ ] **Step 5: Get a Gemini API key**

  Go to https://aistudio.google.com/apikey → Create API key → copy it.

---

### Task 2: Repo structure

**Files:**
- Create: `.gitignore`

- [ ] **Step 1: Create top-level .gitignore**

  ```
  node_modules/
  dist/
  .env
  .env.local
  .env.production
  *.js.map
  .superpowers/
  ```

- [ ] **Step 2: Commit**

  ```bash
  git add .gitignore
  git commit -m "chore: add root .gitignore"
  ```

---

### Task 3: Backend scaffolding

**Files:**
- Create: `backend/package.json`
- Create: `backend/tsconfig.json`
- Create: `backend/vitest.config.ts`
- Create: `backend/src/app.ts`
- Create: `backend/src/index.ts`

- [ ] **Step 1: Write backend/package.json**

  ```json
  {
    "name": "corgi-backend",
    "version": "1.0.0",
    "private": true,
    "scripts": {
      "dev": "tsx watch src/index.ts",
      "build": "tsc",
      "start": "node dist/index.js",
      "test": "vitest run",
      "test:watch": "vitest"
    },
    "dependencies": {
      "@google/generative-ai": "^0.21.0",
      "cors": "^2.8.5",
      "express": "^4.18.0",
      "firebase-admin": "^12.0.0"
    },
    "devDependencies": {
      "@types/cors": "^2.8.17",
      "@types/express": "^4.17.21",
      "@types/node": "^20.0.0",
      "@types/supertest": "^6.0.0",
      "supertest": "^7.0.0",
      "tsx": "^4.0.0",
      "typescript": "^5.0.0",
      "vitest": "^1.6.0"
    }
  }
  ```

- [ ] **Step 2: Write backend/tsconfig.json**

  ```json
  {
    "compilerOptions": {
      "target": "ES2020",
      "module": "commonjs",
      "lib": ["ES2020"],
      "outDir": "./dist",
      "rootDir": "./src",
      "strict": true,
      "esModuleInterop": true,
      "skipLibCheck": true,
      "resolveJsonModule": true
    },
    "include": ["src/**/*"],
    "exclude": ["node_modules", "dist"]
  }
  ```

- [ ] **Step 3: Write backend/vitest.config.ts**

  ```typescript
  import { defineConfig } from 'vitest/config'

  export default defineConfig({
    test: {
      environment: 'node',
    },
  })
  ```

- [ ] **Step 4: Write backend/src/app.ts**

  ```typescript
  import express from 'express'
  import cors from 'cors'

  export function createApp() {
    const app = express()
    app.use(cors({ origin: process.env.FRONTEND_URL }))
    app.use(express.json())
    app.get('/healthz', (_req, res) => res.json({ ok: true }))
    return app
  }
  ```

- [ ] **Step 5: Write backend/src/index.ts**

  ```typescript
  import { initializeApp } from 'firebase-admin/app'
  import { createApp } from './app'

  initializeApp()

  const port = process.env.PORT || 8080
  createApp().listen(port, () => {
    console.log(`Listening on port ${port}`)
  })
  ```

- [ ] **Step 6: Install and verify**

  ```bash
  cd backend && npm install
  FRONTEND_URL=http://localhost:5173 npx tsx src/index.ts
  ```

  Expected: `Listening on port 8080` (Ctrl+C to stop)

- [ ] **Step 7: Commit**

  ```bash
  git add backend/
  git commit -m "feat: backend scaffolding"
  ```

---

### Task 4: Backend auth middleware

**Files:**
- Create: `backend/src/middleware/auth.ts`
- Create: `backend/src/middleware/auth.test.ts`

- [ ] **Step 1: Write the failing tests**

  ```typescript
  // backend/src/middleware/auth.test.ts
  import { describe, it, expect, vi, beforeEach } from 'vitest'
  import request from 'supertest'
  import express from 'express'
  import type { Request, Response } from 'express'

  const mockVerifyIdToken = vi.fn()
  vi.mock('firebase-admin/auth', () => ({
    getAuth: () => ({ verifyIdToken: mockVerifyIdToken }),
  }))

  import { authMiddleware } from './auth'
  import type { AuthRequest } from './auth'

  const app = express()
  app.use(express.json())
  app.get('/test', authMiddleware, (req: Request, res: Response) =>
    res.json({ uid: (req as AuthRequest).uid })
  )

  describe('authMiddleware', () => {
    beforeEach(() => {
      vi.clearAllMocks()
      process.env.ALLOWED_EMAIL = 'owner@example.com'
    })

    it('returns 401 when Authorization header is missing', async () => {
      const res = await request(app).get('/test')
      expect(res.status).toBe(401)
    })

    it('returns 401 when token verification fails', async () => {
      mockVerifyIdToken.mockRejectedValue(new Error('Invalid token'))
      const res = await request(app)
        .get('/test')
        .set('Authorization', 'Bearer bad-token')
      expect(res.status).toBe(401)
    })

    it('returns 401 when email is not in allowlist', async () => {
      mockVerifyIdToken.mockResolvedValue({ uid: 'u1', email: 'other@example.com' })
      const res = await request(app)
        .get('/test')
        .set('Authorization', 'Bearer valid-token')
      expect(res.status).toBe(401)
    })

    it('calls next and sets uid when token is valid and email matches', async () => {
      mockVerifyIdToken.mockResolvedValue({ uid: 'u1', email: 'owner@example.com' })
      const res = await request(app)
        .get('/test')
        .set('Authorization', 'Bearer valid-token')
      expect(res.status).toBe(200)
      expect(res.body.uid).toBe('u1')
    })
  })
  ```

- [ ] **Step 2: Run tests to confirm they fail**

  ```bash
  cd backend && npm test -- --reporter=verbose
  ```

  Expected: 4 failures — `Cannot find module './auth'`

- [ ] **Step 3: Write the implementation**

  ```typescript
  // backend/src/middleware/auth.ts
  import type { Request, Response, NextFunction } from 'express'
  import { getAuth } from 'firebase-admin/auth'

  export interface AuthRequest extends Request {
    uid: string
  }

  export async function authMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    const token = req.headers.authorization?.split('Bearer ')[1]
    if (!token) {
      res.status(401).json({ error: 'Missing token' })
      return
    }
    try {
      const decoded = await getAuth().verifyIdToken(token)
      if (decoded.email !== process.env.ALLOWED_EMAIL) {
        res.status(401).json({ error: 'Unauthorized' })
        return
      }
      ;(req as AuthRequest).uid = decoded.uid
      next()
    } catch {
      res.status(401).json({ error: 'Invalid token' })
    }
  }
  ```

- [ ] **Step 4: Run tests to confirm they pass**

  ```bash
  cd backend && npm test -- --reporter=verbose
  ```

  Expected: 4 tests pass

- [ ] **Step 5: Commit**

  ```bash
  git add backend/src/middleware/
  git commit -m "feat: backend auth middleware"
  ```

---

### Task 5: Backend AIProvider interface + GeminiProvider

**Files:**
- Create: `backend/src/providers/AIProvider.ts`
- Create: `backend/src/providers/GeminiProvider.ts`
- Create: `backend/src/providers/GeminiProvider.test.ts`

- [ ] **Step 1: Write backend/src/providers/AIProvider.ts**

  ```typescript
  export interface Message {
    role: 'user' | 'assistant'
    content: string
  }

  export interface AIProvider {
    chat(history: Message[], newMessage: string): Promise<string>
  }
  ```

- [ ] **Step 2: Write the failing tests**

  ```typescript
  // backend/src/providers/GeminiProvider.test.ts
  import { describe, it, expect, vi } from 'vitest'

  const mockSendMessage = vi.fn()
  const mockStartChat = vi.fn(() => ({ sendMessage: mockSendMessage }))
  const mockGetGenerativeModel = vi.fn(() => ({ startChat: mockStartChat }))

  vi.mock('@google/generative-ai', () => ({
    GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
      getGenerativeModel: mockGetGenerativeModel,
    })),
  }))

  import { GeminiProvider } from './GeminiProvider'

  describe('GeminiProvider', () => {
    it('returns the response text from Gemini', async () => {
      mockSendMessage.mockResolvedValue({
        response: { text: () => 'Hello from Gemini' },
      })
      const provider = new GeminiProvider('fake-key')
      const result = await provider.chat([], 'Hi')
      expect(result).toBe('Hello from Gemini')
    })

    it('maps assistant role to "model" when building history', async () => {
      mockSendMessage.mockResolvedValue({ response: { text: () => 'reply' } })
      const provider = new GeminiProvider('fake-key')
      await provider.chat(
        [
          { role: 'user', content: 'first message' },
          { role: 'assistant', content: 'first reply' },
        ],
        'second message'
      )
      expect(mockStartChat).toHaveBeenCalledWith({
        history: [
          { role: 'user', parts: [{ text: 'first message' }] },
          { role: 'model', parts: [{ text: 'first reply' }] },
        ],
      })
    })
  })
  ```

- [ ] **Step 3: Run tests to confirm they fail**

  ```bash
  cd backend && npm test -- --reporter=verbose
  ```

  Expected: 2 failures — `Cannot find module './GeminiProvider'`

- [ ] **Step 4: Write the implementation**

  ```typescript
  // backend/src/providers/GeminiProvider.ts
  import { GoogleGenerativeAI } from '@google/generative-ai'
  import type { AIProvider, Message } from './AIProvider'

  export class GeminiProvider implements AIProvider {
    private model: ReturnType<InstanceType<typeof GoogleGenerativeAI>['getGenerativeModel']>

    constructor(apiKey: string) {
      const client = new GoogleGenerativeAI(apiKey)
      this.model = client.getGenerativeModel({ model: 'gemini-2.5-flash-lite' })
    }

    async chat(history: Message[], newMessage: string): Promise<string> {
      const chat = this.model.startChat({
        history: history.map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        })),
      })
      const result = await chat.sendMessage(newMessage)
      return result.response.text()
    }
  }
  ```

- [ ] **Step 5: Run all tests**

  ```bash
  cd backend && npm test -- --reporter=verbose
  ```

  Expected: 6 tests pass (4 auth + 2 provider)

- [ ] **Step 6: Commit**

  ```bash
  git add backend/src/providers/
  git commit -m "feat: AIProvider interface and GeminiProvider"
  ```

---

### Task 6: Backend Firestore service

**Files:**
- Create: `backend/src/services/firestore.ts`

No unit tests — coverage comes from route tests in Task 7 which mock this module.

- [ ] **Step 1: Write backend/src/services/firestore.ts**

  ```typescript
  import { getFirestore, Timestamp } from 'firebase-admin/firestore'
  import type { Message } from '../providers/AIProvider'

  export interface ConversationDoc {
    id: string
    uid: string
    title: string
    lastMessage: string
    createdAt: Timestamp
    updatedAt: Timestamp
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
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as ConversationDoc))
  }

  export async function addMessage(
    conversationId: string,
    role: 'user' | 'assistant',
    content: string
  ): Promise<void> {
    const db = getFirestore()
    await db
      .collection('conversations')
      .doc(conversationId)
      .collection('messages')
      .add({ role, content, createdAt: Timestamp.now() })
  }

  export interface FirestoreMessage {
    role: 'user' | 'assistant'
    content: string
    createdAt: string
  }

  export async function getMessages(conversationId: string): Promise<FirestoreMessage[]> {
    const db = getFirestore()
    const snap = await db
      .collection('conversations')
      .doc(conversationId)
      .collection('messages')
      .orderBy('createdAt', 'asc')
      .get()
    return snap.docs.map((d) => ({
      role: d.data().role as 'user' | 'assistant',
      content: d.data().content as string,
      createdAt: (d.data().createdAt as Timestamp).toDate().toISOString(),
    }))
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

- [ ] **Step 2: Commit**

  ```bash
  git add backend/src/services/
  git commit -m "feat: Firestore service helpers"
  ```

---

### Task 7: Backend conversation routes

**Files:**
- Create: `backend/src/routes/conversations.ts`
- Create: `backend/src/routes/conversations.test.ts`
- Modify: `backend/src/app.ts`

- [ ] **Step 1: Write the failing tests**

  ```typescript
  // backend/src/routes/conversations.test.ts
  import { describe, it, expect, vi, beforeEach } from 'vitest'
  import request from 'supertest'
  import express from 'express'
  import type { Request, Response, NextFunction } from 'express'
  import type { AIProvider } from '../providers/AIProvider'

  vi.mock('../services/firestore', () => ({
    createConversation: vi.fn().mockResolvedValue('conv123'),
    getConversation: vi.fn().mockResolvedValue({
      id: 'conv123', uid: 'u1', title: 'Hello world',
      lastMessage: '', createdAt: null, updatedAt: null,
    }),
    listConversations: vi.fn().mockResolvedValue([
      { id: 'conv123', uid: 'u1', title: 'Hello world', lastMessage: 'Hi', updatedAt: null },
    ]),
    addMessage: vi.fn().mockResolvedValue(undefined),
    getMessages: vi.fn().mockResolvedValue([] as Array<{ role: 'user' | 'assistant'; content: string; createdAt: string }>),
    updateConversationLastMessage: vi.fn().mockResolvedValue(undefined),
    deleteConversation: vi.fn().mockResolvedValue(undefined),
  }))

  import { createConversationsRouter } from './conversations'
  import * as firestoreService from '../services/firestore'

  const mockAI: AIProvider = { chat: vi.fn().mockResolvedValue('AI reply') }

  function mockAuth(req: Request, _: Response, next: NextFunction) {
    ;(req as any).uid = 'u1'
    next()
  }

  const app = express()
  app.use(express.json())
  app.use('/api/conversations', mockAuth, createConversationsRouter(mockAI))

  beforeEach(() => vi.clearAllMocks())

  describe('POST /api/conversations', () => {
    it('creates conversation and returns assistantMessage', async () => {
      const res = await request(app)
        .post('/api/conversations')
        .send({ message: 'Hello world' })
      expect(res.status).toBe(200)
      expect(res.body.conversationId).toBe('conv123')
      expect(res.body.title).toBe('Hello world')
      expect(res.body.assistantMessage).toBe('AI reply')
    })

    it('returns 400 when message is missing', async () => {
      const res = await request(app).post('/api/conversations').send({})
      expect(res.status).toBe(400)
    })

    it('truncates title to 40 chars', async () => {
      await request(app)
        .post('/api/conversations')
        .send({ message: 'A'.repeat(60) })
      expect(firestoreService.createConversation).toHaveBeenCalledWith('u1', 'A'.repeat(40))
    })
  })

  describe('POST /api/conversations/:id/messages', () => {
    it('returns assistantMessage', async () => {
      const res = await request(app)
        .post('/api/conversations/conv123/messages')
        .send({ message: 'Follow up' })
      expect(res.status).toBe(200)
      expect(res.body.assistantMessage).toBe('AI reply')
    })

    it('returns 404 when conversation not found', async () => {
      vi.mocked(firestoreService.getConversation).mockResolvedValueOnce(null)
      const res = await request(app)
        .post('/api/conversations/missing/messages')
        .send({ message: 'hi' })
      expect(res.status).toBe(404)
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

- [ ] **Step 2: Run tests to confirm they fail**

  ```bash
  cd backend && npm test -- --reporter=verbose
  ```

  Expected: failures — `Cannot find module './conversations'`

- [ ] **Step 3: Write backend/src/routes/conversations.ts**

  ```typescript
  import { Router } from 'express'
  import type { AIProvider } from '../providers/AIProvider'
  import type { AuthRequest } from '../middleware/auth'
  import * as db from '../services/firestore'

  export function createConversationsRouter(ai: AIProvider): Router {
    const router = Router()

    router.post('/', async (req, res) => {
      const { message } = req.body
      const uid = (req as AuthRequest).uid
      if (!message?.trim()) {
        res.status(400).json({ error: 'message is required' })
        return
      }
      const title = (message as string).slice(0, 40)
      const conversationId = await db.createConversation(uid, title)
      await db.addMessage(conversationId, 'user', message)
      const assistantMessage = await ai.chat([], message)
      await db.addMessage(conversationId, 'assistant', assistantMessage)
      await db.updateConversationLastMessage(conversationId, assistantMessage)
      res.json({ conversationId, title, assistantMessage })
    })

    router.post('/:id/messages', async (req, res) => {
      const { message } = req.body
      const uid = (req as AuthRequest).uid
      const { id } = req.params
      if (!message?.trim()) {
        res.status(400).json({ error: 'message is required' })
        return
      }
      const conversation = await db.getConversation(id, uid)
      if (!conversation) {
        res.status(404).json({ error: 'Conversation not found' })
        return
      }
      const history = await db.getMessages(id)
      const aiHistory = history.map(({ role, content }) => ({ role, content }))
      await db.addMessage(id, 'user', message)
      const assistantMessage = await ai.chat(aiHistory, message)
      await db.addMessage(id, 'assistant', assistantMessage)
      await db.updateConversationLastMessage(id, assistantMessage)
      res.json({ assistantMessage })
    })

    router.get('/', async (req, res) => {
      const uid = (req as AuthRequest).uid
      const conversations = await db.listConversations(uid)
      res.json(
        conversations.map((c) => ({
          id: c.id,
          title: c.title,
          lastMessage: c.lastMessage,
          updatedAt: c.updatedAt.toDate().toISOString(),
        }))
      )
    })

    router.get('/:id/messages', async (req, res) => {
      const uid = (req as AuthRequest).uid
      const { id } = req.params
      const conversation = await db.getConversation(id, uid)
      if (!conversation) {
        res.status(404).json({ error: 'Conversation not found' })
        return
      }
      const messages = await db.getMessages(id)
      res.json(messages)
    })

    router.delete('/:id', async (req, res) => {
      const uid = (req as AuthRequest).uid
      const { id } = req.params
      const conversation = await db.getConversation(id, uid)
      if (!conversation) {
        res.status(404).json({ error: 'Conversation not found' })
        return
      }
      await db.deleteConversation(id)
      res.status(204).send()
    })

    return router
  }
  ```

- [ ] **Step 4: Update backend/src/app.ts to wire up routes**

  ```typescript
  import express from 'express'
  import cors from 'cors'
  import { authMiddleware } from './middleware/auth'
  import { GeminiProvider } from './providers/GeminiProvider'
  import { createConversationsRouter } from './routes/conversations'

  export function createApp() {
    const app = express()
    app.use(cors({ origin: process.env.FRONTEND_URL }))
    app.use(express.json())
    app.get('/healthz', (_req, res) => res.json({ ok: true }))
    app.use(
      '/api/conversations',
      authMiddleware,
      createConversationsRouter(new GeminiProvider(process.env.GEMINI_API_KEY!))
    )
    return app
  }
  ```

- [ ] **Step 5: Run all tests**

  ```bash
  cd backend && npm test -- --reporter=verbose
  ```

  Expected: 14 tests pass (4 auth + 2 provider + 8 routes)

- [ ] **Step 6: Commit**

  ```bash
  git add backend/src/routes/ backend/src/app.ts
  git commit -m "feat: conversation routes"
  ```

---

### Task 8: Backend Dockerfile + env example

**Files:**
- Create: `backend/Dockerfile`
- Create: `backend/.env.example`
- Create: `backend/.dockerignore`

- [ ] **Step 1: Write backend/.env.example**

  ```
  ALLOWED_EMAIL=you@gmail.com
  GEMINI_API_KEY=your-gemini-api-key
  FIREBASE_PROJECT_ID=your-firebase-project-id
  FRONTEND_URL=http://localhost:5173
  PORT=8080
  ```

- [ ] **Step 2: Write backend/.dockerignore**

  ```
  node_modules
  dist
  .env
  *.test.ts
  ```

- [ ] **Step 3: Write backend/Dockerfile**

  ```dockerfile
  FROM node:20-alpine AS builder
  WORKDIR /app
  COPY package*.json ./
  RUN npm ci
  COPY tsconfig.json ./
  COPY src ./src
  RUN npm run build

  FROM node:20-alpine
  WORKDIR /app
  COPY package*.json ./
  RUN npm ci --omit=dev
  COPY --from=builder /app/dist ./dist
  EXPOSE 8080
  CMD ["node", "dist/index.js"]
  ```

- [ ] **Step 4: Commit**

  ```bash
  git add backend/Dockerfile backend/.env.example backend/.dockerignore
  git commit -m "feat: backend Dockerfile"
  ```

---

### Task 9: Frontend scaffolding

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/tsconfig.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/index.html`
- Create: `frontend/.env.example`
- Create: `frontend/src/main.tsx`
- Create: `frontend/src/types.ts`
- Create: `frontend/src/test-setup.ts`

- [ ] **Step 1: Write frontend/package.json**

  ```json
  {
    "name": "corgi-frontend",
    "version": "1.0.0",
    "private": true,
    "type": "module",
    "scripts": {
      "dev": "vite",
      "build": "tsc && vite build",
      "preview": "vite preview",
      "test": "vitest run",
      "test:watch": "vitest"
    },
    "dependencies": {
      "firebase": "^10.12.0",
      "react": "^18.3.0",
      "react-dom": "^18.3.0",
      "react-router-dom": "^6.23.0"
    },
    "devDependencies": {
      "@testing-library/jest-dom": "^6.4.0",
      "@testing-library/react": "^16.0.0",
      "@types/react": "^18.3.0",
      "@types/react-dom": "^18.3.0",
      "@vitejs/plugin-react": "^4.3.0",
      "jsdom": "^24.1.0",
      "typescript": "^5.4.0",
      "vite": "^5.3.0",
      "vite-plugin-pwa": "^0.20.0",
      "vitest": "^1.6.0"
    }
  }
  ```

- [ ] **Step 2: Write frontend/tsconfig.json**

  ```json
  {
    "compilerOptions": {
      "target": "ES2020",
      "useDefineForClassFields": true,
      "lib": ["ES2020", "DOM", "DOM.Iterable"],
      "module": "ESNext",
      "skipLibCheck": true,
      "moduleResolution": "bundler",
      "allowImportingTsExtensions": true,
      "resolveJsonModule": true,
      "isolatedModules": true,
      "noEmit": true,
      "jsx": "react-jsx",
      "strict": true
    },
    "include": ["src"]
  }
  ```

- [ ] **Step 3: Write frontend/vite.config.ts** (PWA plugin added in Task 14)

  ```typescript
  import { defineConfig } from 'vite'
  import react from '@vitejs/plugin-react'

  export default defineConfig({
    plugins: [react()],
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: './src/test-setup.ts',
    },
  })
  ```

- [ ] **Step 4: Write frontend/src/test-setup.ts**

  ```typescript
  import '@testing-library/jest-dom'
  ```

- [ ] **Step 5: Write frontend/index.html**

  ```html
  <!doctype html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
      <title>corgi</title>
    </head>
    <body>
      <div id="root"></div>
      <script type="module" src="/src/main.tsx"></script>
    </body>
  </html>
  ```

- [ ] **Step 6: Write frontend/.env.example**

  ```
  VITE_FIREBASE_API_KEY=
  VITE_FIREBASE_AUTH_DOMAIN=
  VITE_FIREBASE_PROJECT_ID=
  VITE_API_URL=http://localhost:8080
  ```

- [ ] **Step 7: Write frontend/src/types.ts**

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
  }
  ```

- [ ] **Step 8: Write frontend/src/main.tsx**

  ```tsx
  import React from 'react'
  import ReactDOM from 'react-dom/client'
  import { BrowserRouter } from 'react-router-dom'
  import App from './App'

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </React.StrictMode>
  )
  ```

- [ ] **Step 9: Install and verify TypeScript compiles**

  ```bash
  cd frontend && npm install
  npx tsc --noEmit
  ```

  Expected: no errors (App.tsx doesn't exist yet — that's fine, tsc only checks `src/`)

- [ ] **Step 10: Commit**

  ```bash
  git add frontend/
  git commit -m "feat: frontend scaffolding"
  ```

---

### Task 10: Frontend Firebase init + login page + auth gate

**Files:**
- Create: `frontend/src/firebase.ts`
- Create: `frontend/src/pages/LoginPage.tsx`
- Create: `frontend/src/pages/ChatPage.tsx` (placeholder)
- Create: `frontend/src/App.tsx`

- [ ] **Step 1: Create frontend/.env.local with your Firebase config** (not committed)

  ```
  VITE_FIREBASE_API_KEY=<from Firebase console>
  VITE_FIREBASE_AUTH_DOMAIN=<project-id>.firebaseapp.com
  VITE_FIREBASE_PROJECT_ID=<project-id>
  VITE_API_URL=http://localhost:8080
  ```

- [ ] **Step 2: Write frontend/src/firebase.ts**

  ```typescript
  import { initializeApp } from 'firebase/app'
  import { getAuth } from 'firebase/auth'

  const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  }

  export const app = initializeApp(firebaseConfig)
  export const auth = getAuth(app)
  ```

- [ ] **Step 3: Write frontend/src/pages/LoginPage.tsx**

  ```tsx
  import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth'
  import { auth } from '../firebase'

  export default function LoginPage() {
    async function handleSignIn() {
      const provider = new GoogleAuthProvider()
      await signInWithPopup(auth, provider)
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100dvh', gap: '24px' }}>
        <h1 style={{ fontSize: '2rem', fontWeight: 'bold', margin: 0 }}>corgi</h1>
        <button
          onClick={handleSignIn}
          style={{ padding: '12px 24px', fontSize: '1rem', cursor: 'pointer', borderRadius: '8px', border: '1px solid #ccc' }}
        >
          Sign in with Google
        </button>
      </div>
    )
  }
  ```

- [ ] **Step 4: Write a placeholder frontend/src/pages/ChatPage.tsx**

  ```tsx
  import type { User } from 'firebase/auth'

  interface Props { user: User }

  export default function ChatPage({ user }: Props) {
    return <div style={{ padding: '16px' }}>Chat — logged in as {user.email}</div>
  }
  ```

- [ ] **Step 5: Write frontend/src/App.tsx**

  ```tsx
  import { useEffect, useState } from 'react'
  import { Routes, Route, Navigate } from 'react-router-dom'
  import { onAuthStateChanged } from 'firebase/auth'
  import type { User } from 'firebase/auth'
  import { auth } from './firebase'
  import LoginPage from './pages/LoginPage'
  import ChatPage from './pages/ChatPage'

  export default function App() {
    const [user, setUser] = useState<User | null | undefined>(undefined)

    useEffect(() => {
      return onAuthStateChanged(auth, setUser)
    }, [])

    if (user === undefined) return null

    return (
      <Routes>
        <Route
          path="/login"
          element={user ? <Navigate to="/" replace /> : <LoginPage />}
        />
        <Route
          path="/"
          element={user ? <ChatPage user={user} /> : <Navigate to="/login" replace />}
        />
      </Routes>
    )
  }
  ```

- [ ] **Step 6: Start dev server and verify login works**

  ```bash
  cd frontend && npm run dev
  ```

  Open http://localhost:5173 → redirects to /login → "Sign in with Google" → lands on / showing your email.

- [ ] **Step 7: Commit**

  ```bash
  git add frontend/src/
  git commit -m "feat: Firebase auth + login page"
  ```

---

### Task 11: Frontend API client

**Files:**
- Create: `frontend/src/api.ts`
- Create: `frontend/src/api.test.ts`

- [ ] **Step 1: Write the failing tests**

  ```typescript
  // frontend/src/api.test.ts
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

  beforeEach(() => vi.clearAllMocks())

  function mockResponse(body: unknown, status = 200) {
    mockFetch.mockResolvedValue({
      ok: status < 400,
      status,
      json: () => Promise.resolve(body),
    })
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
    it('sends POST /api/conversations with message body', async () => {
      mockResponse({ conversationId: 'c1', title: 'Hi', assistantMessage: 'Hello' })
      const result = await api.createConversation('Hi')
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/conversations'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ message: 'Hi' }),
        })
      )
      expect(result.conversationId).toBe('c1')
    })
  })

  describe('api.sendMessage', () => {
    it('sends POST /api/conversations/:id/messages', async () => {
      mockResponse({ assistantMessage: 'reply' })
      const result = await api.sendMessage('c1', 'Follow up')
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/conversations/c1/messages'),
        expect.objectContaining({ method: 'POST' })
      )
      expect(result.assistantMessage).toBe('reply')
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

- [ ] **Step 2: Run tests to confirm they fail**

  ```bash
  cd frontend && npm test -- --reporter=verbose
  ```

  Expected: 4 failures — `Cannot find module './api'`

- [ ] **Step 3: Write frontend/src/api.ts**

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

  export const api = {
    listConversations: () =>
      request<Conversation[]>('/api/conversations'),

    getMessages: (conversationId: string) =>
      request<Message[]>(`/api/conversations/${conversationId}/messages`),

    createConversation: (message: string) =>
      request<{ conversationId: string; title: string; assistantMessage: string }>(
        '/api/conversations',
        { method: 'POST', body: JSON.stringify({ message }) }
      ),

    sendMessage: (conversationId: string, message: string) =>
      request<{ assistantMessage: string }>(
        `/api/conversations/${conversationId}/messages`,
        { method: 'POST', body: JSON.stringify({ message }) }
      ),

    deleteConversation: (conversationId: string) =>
      request<void>(`/api/conversations/${conversationId}`, { method: 'DELETE' }),
  }
  ```

- [ ] **Step 4: Run all frontend tests**

  ```bash
  cd frontend && npm test -- --reporter=verbose
  ```

  Expected: 4 tests pass

- [ ] **Step 5: Commit**

  ```bash
  git add frontend/src/api.ts frontend/src/api.test.ts
  git commit -m "feat: frontend API client"
  ```

---

### Task 12: Frontend chat page

**Files:**
- Create: `frontend/src/components/MessageList.tsx`
- Create: `frontend/src/components/MessageInput.tsx`
- Modify: `frontend/src/pages/ChatPage.tsx`

- [ ] **Step 1: Write frontend/src/components/MessageList.tsx**

  ```tsx
  import { useEffect, useRef } from 'react'
  import type { Message } from '../types'

  interface Props { messages: Message[] }

  export default function MessageList({ messages }: Props) {
    const bottomRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [messages])

    return (
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {messages.map((m, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <div style={{
              maxWidth: '80%',
              padding: '10px 14px',
              borderRadius: m.role === 'user' ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
              background: m.role === 'user' ? '#0084ff' : '#e9e9eb',
              color: m.role === 'user' ? '#fff' : '#000',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}>
              {m.content}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    )
  }
  ```

- [ ] **Step 2: Write frontend/src/components/MessageInput.tsx**

  ```tsx
  import { useState, useRef, useEffect } from 'react'

  interface Props {
    onSend: (message: string) => void
    disabled: boolean
  }

  export default function MessageInput({ onSend, disabled }: Props) {
    const [text, setText] = useState('')
    const textareaRef = useRef<HTMLTextAreaElement>(null)

    useEffect(() => {
      if (!disabled) textareaRef.current?.focus()
    }, [disabled])

    function handleKeyDown(e: React.KeyboardEvent) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    }

    function handleSend() {
      const trimmed = text.trim()
      if (!trimmed || disabled) return
      onSend(trimmed)
      setText('')
    }

    return (
      <div style={{
        display: 'flex', gap: '8px', padding: '12px',
        paddingBottom: 'max(12px, env(safe-area-inset-bottom))',
        borderTop: '1px solid #e0e0e0', background: '#fff',
      }}>
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder="Message..."
          rows={1}
          style={{
            flex: 1, resize: 'none', border: '1px solid #e0e0e0',
            borderRadius: '20px', padding: '10px 14px', fontSize: '16px',
            outline: 'none', fontFamily: 'inherit',
          }}
        />
        <button
          onClick={handleSend}
          disabled={disabled || !text.trim()}
          style={{
            width: '40px', height: '40px', borderRadius: '50%',
            background: '#0084ff', border: 'none', color: '#fff',
            fontSize: '18px', cursor: 'pointer', flexShrink: 0, alignSelf: 'flex-end',
          }}
        >
          ↑
        </button>
      </div>
    )
  }
  ```

- [ ] **Step 3: Replace the placeholder with the full frontend/src/pages/ChatPage.tsx**

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
      try {
        const userMsg: Message = { role: 'user', content: text, createdAt: new Date().toISOString() }
        setMessages((prev) => [...prev, userMsg])

        if (!activeId) {
          const { conversationId, title, assistantMessage } = await api.createConversation(text)
          setMessages((prev) => [...prev, { role: 'assistant', content: assistantMessage, createdAt: new Date().toISOString() }])
          setActiveId(conversationId)
          setConversations((prev) => [
            { id: conversationId, title, lastMessage: assistantMessage, updatedAt: new Date().toISOString() },
            ...prev,
          ])
        } else {
          const { assistantMessage } = await api.sendMessage(activeId, text)
          setMessages((prev) => [...prev, { role: 'assistant', content: assistantMessage, createdAt: new Date().toISOString() }])
          setConversations((prev) =>
            prev.map((c) =>
              c.id === activeId
                ? { ...c, lastMessage: assistantMessage, updatedAt: new Date().toISOString() }
                : c
            )
          )
        }
      } catch (e) {
        console.error(e)
      } finally {
        setSending(false)
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
      <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', maxWidth: '600px', margin: '0 auto', position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid #e0e0e0', background: '#fff' }}>
          <button onClick={() => setDrawerOpen(true)} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', padding: '4px' }}>☰</button>
          <span style={{ fontWeight: 'bold' }}>corgi</span>
          <img
            src={user.photoURL ?? undefined}
            alt={user.displayName ?? 'user'}
            onClick={() => signOut(auth)}
            title="Sign out"
            style={{ width: '32px', height: '32px', borderRadius: '50%', cursor: 'pointer' }}
          />
        </div>

        {messages.length === 0 && !sending ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999' }}>
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

- [ ] **Step 4: Commit**

  ```bash
  git add frontend/src/
  git commit -m "feat: chat page with message list and input"
  ```

---

### Task 13: Frontend history drawer

**Files:**
- Create: `frontend/src/components/HistoryDrawer.tsx`

- [ ] **Step 1: Write frontend/src/components/HistoryDrawer.tsx**

  ```tsx
  import type { Conversation } from '../types'

  interface Props {
    conversations: Conversation[]
    activeId: string | null
    onSelect: (id: string) => void
    onDelete: (id: string) => void
    onNewChat: () => void
    onClose: () => void
  }

  function relativeTime(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime()
    const minutes = Math.floor(diff / 60000)
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    return `${Math.floor(hours / 24)}d ago`
  }

  export default function HistoryDrawer({ conversations, activeId, onSelect, onDelete, onNewChat, onClose }: Props) {
    return (
      <>
        <div
          onClick={onClose}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 10 }}
        />
        <div style={{ position: 'fixed', top: 0, left: 0, bottom: 0, width: '280px', background: '#fff', zIndex: 11, display: 'flex', flexDirection: 'column', boxShadow: '2px 0 8px rgba(0,0,0,0.15)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px', borderBottom: '1px solid #e0e0e0' }}>
            <span style={{ fontWeight: 'bold' }}>Conversations</span>
            <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer' }}>✕</button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {conversations.length === 0 && (
              <div style={{ padding: '24px 16px', color: '#999', textAlign: 'center' }}>No conversations yet</div>
            )}
            {conversations.map((c) => (
              <div
                key={c.id}
                style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid #f0f0f0', background: c.id === activeId ? '#f0f7ff' : 'transparent', cursor: 'pointer' }}
                onClick={() => onSelect(c.id)}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</div>
                  <div style={{ fontSize: '12px', color: '#999', marginTop: '2px' }}>{relativeTime(c.updatedAt)}</div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(c.id) }}
                  style={{ background: 'none', border: 'none', color: '#ccc', fontSize: '16px', cursor: 'pointer', padding: '4px', marginLeft: '8px', flexShrink: 0 }}
                >
                  🗑
                </button>
              </div>
            ))}
          </div>

          <div style={{ padding: '16px', borderTop: '1px solid #e0e0e0' }}>
            <button
              onClick={onNewChat}
              style={{ width: '100%', padding: '12px', background: '#0084ff', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '16px', cursor: 'pointer', fontWeight: 500 }}
            >
              + New chat
            </button>
          </div>
        </div>
      </>
    )
  }
  ```

- [ ] **Step 2: Run the backend with real credentials and verify end-to-end**

  ```bash
  # Terminal 1 — backend
  cd backend
  cp .env.example .env   # fill in ALLOWED_EMAIL, GEMINI_API_KEY, FIREBASE_PROJECT_ID
  npx tsx src/index.ts

  # Terminal 2 — frontend
  cd frontend && npm run dev
  ```

  Verify in the browser:
  - Login with Google → lands on chat screen
  - Send a message → AI responds, conversation appears in drawer
  - Open drawer → tap conversation → loads messages
  - Delete conversation → removed from list
  - New chat button → clears active conversation

- [ ] **Step 3: Commit**

  ```bash
  git add frontend/src/components/HistoryDrawer.tsx
  git commit -m "feat: history drawer"
  ```

---

### Task 14: Frontend PWA

**Files:**
- Create: `frontend/public/icon-192.png`
- Create: `frontend/public/icon-512.png`
- Modify: `frontend/vite.config.ts`

- [ ] **Step 1: Create PWA icons**

  Create a 192×192 and 512×512 PNG icon. Quick placeholder with ImageMagick:

  ```bash
  convert -size 192x192 xc:'#0084ff' -gravity center -pointsize 72 -fill white -annotate 0 'C' frontend/public/icon-192.png
  convert -size 512x512 xc:'#0084ff' -gravity center -pointsize 192 -fill white -annotate 0 'C' frontend/public/icon-512.png
  ```

  If ImageMagick is not installed, create any 192×192 and 512×512 PNG and place them at those paths.

- [ ] **Step 2: Update frontend/vite.config.ts to add VitePWA**

  ```typescript
  import { defineConfig } from 'vite'
  import react from '@vitejs/plugin-react'
  import { VitePWA } from 'vite-plugin-pwa'

  export default defineConfig({
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        manifest: {
          name: 'corgi',
          short_name: 'corgi',
          description: 'Personal AI chat',
          theme_color: '#0084ff',
          background_color: '#ffffff',
          display: 'standalone',
          start_url: '/',
          icons: [
            { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
          runtimeCaching: [],
        },
      }),
    ],
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: './src/test-setup.ts',
    },
  })
  ```

- [ ] **Step 3: Build and verify the manifest**

  ```bash
  cd frontend && npm run build && npm run preview
  ```

  Open http://localhost:4173 in Chrome → DevTools → Application → Manifest.
  Expected: name "corgi", display "standalone", 2 icons listed.

- [ ] **Step 4: Commit**

  ```bash
  git add frontend/
  git commit -m "feat: PWA manifest and service worker"
  ```

---

### Task 15: Deploy backend to Cloud Run

- [ ] **Step 1: Enable required GCP APIs**

  ```bash
  gcloud services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com
  ```

- [ ] **Step 2: Create Artifact Registry repository**

  ```bash
  gcloud artifacts repositories create corgi \
    --repository-format=docker \
    --location=asia-northeast1
  ```

  Replace `asia-northeast1` with the region closest to you.

- [ ] **Step 3: Build and push the Docker image via Cloud Build**

  ```bash
  cd backend
  gcloud builds submit \
    --tag asia-northeast1-docker.pkg.dev/YOUR_PROJECT_ID/corgi/backend:latest
  ```

- [ ] **Step 4: Deploy to Cloud Run**

  ```bash
  gcloud run deploy corgi-backend \
    --image asia-northeast1-docker.pkg.dev/YOUR_PROJECT_ID/corgi/backend:latest \
    --region asia-northeast1 \
    --allow-unauthenticated \
    --min-instances 0 \
    --max-instances 2 \
    --set-env-vars "ALLOWED_EMAIL=YOUR_EMAIL,GEMINI_API_KEY=YOUR_GEMINI_KEY,FIREBASE_PROJECT_ID=YOUR_PROJECT_ID,FRONTEND_URL=https://YOUR_PROJECT_ID.web.app"
  ```

  Note the deployed URL shown in the output — you'll need it in Task 16.

- [ ] **Step 5: Verify the health check**

  ```bash
  curl https://YOUR_CLOUD_RUN_URL/healthz
  ```

  Expected: `{"ok":true}`

- [ ] **Step 6: Commit**

  ```bash
  git add .
  git commit -m "chore: Cloud Run deployment"
  ```

---

### Task 16: Deploy frontend to Firebase Hosting

- [ ] **Step 1: Install Firebase CLI if not already installed**

  ```bash
  npm install -g firebase-tools && firebase login
  ```

- [ ] **Step 2: Create frontend/.env.production with production values** (not committed)

  ```
  VITE_FIREBASE_API_KEY=<from Firebase console>
  VITE_FIREBASE_AUTH_DOMAIN=YOUR_PROJECT_ID.firebaseapp.com
  VITE_FIREBASE_PROJECT_ID=YOUR_PROJECT_ID
  VITE_API_URL=https://YOUR_CLOUD_RUN_URL
  ```

- [ ] **Step 3: Build the production bundle**

  ```bash
  cd frontend && npm run build
  ```

  Expected: `dist/` created, no TypeScript errors.

- [ ] **Step 4: Initialize Firebase Hosting**

  ```bash
  cd frontend && firebase init hosting
  ```

  Prompts:
  - Use existing project → select your Firebase project
  - Public directory: `dist`
  - Configure as SPA: **Yes**
  - Overwrite `dist/index.html`: **No**

- [ ] **Step 5: Deploy**

  ```bash
  cd frontend && firebase deploy --only hosting
  ```

  Expected output includes: `Hosting URL: https://YOUR_PROJECT_ID.web.app`

- [ ] **Step 6: Add the Hosting domain to Firebase Auth authorized domains**

  Firebase console → Authentication → Settings → Authorized domains → Add `YOUR_PROJECT_ID.web.app`

- [ ] **Step 7: Open on your phone and install as PWA**

  Navigate to `https://YOUR_PROJECT_ID.web.app` in your mobile browser.
  - **Safari (iOS):** Share → Add to Home Screen
  - **Chrome (Android):** menu → Add to Home Screen (or "Install app" banner)

- [ ] **Step 8: Commit**

  ```bash
  git add frontend/firebase.json frontend/.firebaserc
  git commit -m "chore: Firebase Hosting config"
  ```
