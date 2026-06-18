# Design: Corgi — Personal AI Chat Web App

Date: 2026-06-18

## Overview

A personal AI chat web app built on GCP/Firebase. Mobile-first PWA. Single authorized user. Google login via Firebase Authentication. Chat UI with slide-out history drawer. Node.js backend on Cloud Run calls Gemini and manages all data in Firestore.

---

## Section 1: Architecture & Stack

```
Browser (PWA, mobile-first)
  ↓ Firebase ID token on every request
Firebase Hosting (static assets)
Cloud Run API (Node.js + TypeScript + Express)
  ├── Firebase Admin SDK (token verification + email allowlist)
  ├── Firestore (conversations + messages)
  └── Gemini API (gemini-2.5-flash-lite)
```

**Frontend:** React + Vite + TypeScript, deployed to Firebase Hosting
**Backend:** Node.js + TypeScript + Express, deployed to Cloud Run (min 0, max 2 instances)
**Auth:** Firebase Authentication (Google login)
**DB:** Firestore
**AI:** Gemini API (`gemini-2.5-flash-lite`)

Environment variables on Cloud Run (never hardcoded):
```
ALLOWED_EMAIL=<owner email>
GEMINI_API_KEY=...
FIREBASE_PROJECT_ID=...
```

---

## Section 2: Frontend — Screens & PWA

### Screens

**`/login` — Login screen**
- "Sign in with Google" button
- Redirects to `/` after successful auth

**`/` — Chat screen (default)**
- Opens to the current conversation, or a blank state if no conversations exist
- Message list scrolls upward
- Input bar pinned to bottom (handles mobile keyboard inset)
- Hamburger (☰) top-left opens the history drawer
- Authenticated user avatar top-right

**History drawer (slide-in overlay)**
- Full-height overlay sliding in from the left
- Lists conversations: title + relative timestamp
- Tap to switch conversation
- Delete button per conversation item
- "New chat" button at the bottom of the drawer

### PWA

- `manifest.json`: `name: "corgi"`, icons, `display: standalone`, `theme_color`
- `vite-plugin-pwa` generates service worker (precaches app shell only)
- No offline AI — API responses are not cached

---

## Section 3: Firestore Schema

```
conversations/{conversationId}
  - uid: string              ← Firebase Auth uid, scopes data to the owner
  - title: string            ← first 40 chars of the first user message
  - lastMessage: string      ← content of the most recent assistant message (preview for history list)
  - createdAt: timestamp
  - updatedAt: timestamp

conversations/{conversationId}/messages/{messageId}
  - role: "user" | "assistant"
  - content: string
  - createdAt: timestamp
```

**Notes:**
- Messages are a subcollection so conversation list queries don't fetch message content
- `lastMessage` and `updatedAt` are denormalized on the conversation document for efficient list rendering
- Both fields are updated whenever a new assistant message is saved
- No `users` collection — Firebase Authentication already provides uid, email, and createdAt

---

## Section 4: API Contract

All endpoints require `Authorization: Bearer <Firebase ID token>`.

### Create conversation + send first message
```
POST /api/conversations
Body:    { message: string }
Action:  Creates conversation (title = first 40 chars of message),
         sends message to Gemini, saves user + assistant messages,
         sets lastMessage + updatedAt
Returns: { conversationId: string, title: string, assistantMessage: string }
```

### Send message to existing conversation
```
POST /api/conversations/:id/messages
Body:    { message: string }
Action:  Fetches full message history from Firestore, sends to Gemini
         with full context, saves user + assistant messages,
         updates lastMessage + updatedAt on conversation
Returns: { assistantMessage: string }
```

### List conversations
```
GET /api/conversations
Returns: [{ id: string, title: string, lastMessage: string, updatedAt: timestamp }]
         ordered by updatedAt descending
```

### Get messages for a conversation
```
GET /api/conversations/:id/messages
Returns: [{ role: "user" | "assistant", content: string, createdAt: timestamp }]
         ordered by createdAt ascending
```

### Delete conversation
```
DELETE /api/conversations/:id
Action:  Deletes conversation document + all messages in subcollection
Returns: 204 No Content
```

---

## Section 5: Auth & Security

### Login flow
1. User opens PWA → Firebase SDK checks auth state
2. Not authenticated → redirect to `/login`
3. Tap "Sign in with Google" → Firebase popup auth
4. On success → Firebase stores session, redirect to `/`
5. Frontend attaches `Authorization: Bearer <ID token>` to every API call
6. Firebase SDK auto-refreshes ID token every hour

### Backend auth middleware (runs on every request)
1. Extract Bearer token from `Authorization` header
2. Verify token with Firebase Admin SDK
3. Check `decodedToken.email === process.env.ALLOWED_EMAIL`
4. If either check fails → return `401 Unauthorized`
5. Attach `uid` to request context; all Firestore queries are scoped to that `uid`

### AI provider abstraction
The Gemini integration is wrapped behind an `AIProvider` interface so a different model or LangChain can be swapped in later without changing the API layer:

```typescript
interface AIProvider {
  chat(history: Message[], newMessage: string): Promise<string>
}

class GeminiProvider implements AIProvider { ... }
```

### CORS
Restricted to the Firebase Hosting domain only.

---

## Out of Scope (MVP)

- Streaming responses
- Offline AI
- Multi-user / public release
- Usage limits
- RAG / vector database
- LangChain
- Admin dashboard
- Payment
- Mobile app (native)
- SSR

---

## Development Priority Order

1. Firebase project setup + Google login
2. Frontend: login screen + PWA shell
3. Backend: Cloud Run skeleton + auth middleware
4. Backend: Gemini integration (`AIProvider` interface + `GeminiProvider`)
5. Backend: Firestore read/write + API endpoints
6. Frontend: chat screen + history drawer
7. End-to-end integration
8. Deploy: Firebase Hosting + Cloud Run
