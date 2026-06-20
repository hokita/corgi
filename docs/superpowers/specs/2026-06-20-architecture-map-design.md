# Architecture Map Design

**Date:** 2026-06-20
**Scope:** Add layered class/module relationship maps to `docs/backend.html` and `docs/frontend.html`

## Goal

Add an interactive, full-detail layered architecture diagram to both doc pages so the relationship between modules, classes, types, and external dependencies is immediately visible without reading source files.

## Approach

Pure HTML/CSS inline in each existing doc file. No external dependencies. Swim-lane layers with nested module boxes, consistent with each page's existing card/table styles. Full detail: module names, function signatures, type definitions, and flow connectors between layers.

---

## Backend (`docs/backend.html`)

### Change

Replace the existing "Class & Type Architecture" section (added in the prior session) with a new full-detail layered diagram. The prior section's content is superseded by the richer diagram.

### Layers (top → bottom)

| Layer | Contents |
|---|---|
| **Entry Point** | `index.ts` (Firebase Admin init, server listen) · `app.ts` — `createApp()` (CORS, JSON, healthz, mounts authMiddleware + router, instantiates `GeminiProvider`) |
| **Middleware** | `auth.ts` — `authMiddleware`: extract Bearer token → `verifyIdToken()` → guard email → set `req.uid`; reject 401 on any failure |
| **Routes** | `conversations.ts` — `createConversationsRouter(ai: AIProvider)`: 5 endpoints, try/catch → 500, maps `FirestoreMessage[]` → `Message[]` before `ai.chat()` |
| **API Types** | `models/api.ts` — 7 interfaces: `CreateConversationRequest/Response`, `SendMessageRequest/Response`, `ConversationSummary`, `MessageResponse`, `ErrorResponse` |
| **Providers** (left) | `AIProvider.ts` — `interface AIProvider { chat(Message[], string): Promise<string> }` + `type Message` → implemented by `GeminiProvider.ts` — `class GeminiProvider`: private `model: GenerativeModel`, `constructor(apiKey)`, `chat()` maps `assistant→model`, `startChat()+sendMessage()` |
| **Services** (right) | `firestore.ts` — `interface ConversationDoc`, `interface FirestoreMessage`, 7 exported functions: `createConversation`, `getConversation`, `listConversations`, `addMessage`, `getMessages`, `updateConversationLastMessage`, `deleteConversation` |
| **External** | Providers column → Gemini API (`gemini-2.5-flash-lite`) · Services column → Firestore (`conversations/{id}` + subcollection `messages/{id}`) |

Providers and Services columns are parallel (both consumed by Routes), each with their own External row beneath.

---

## Frontend (`docs/frontend.html`)

### Change

Add a new "Class & Module Architecture" section after the existing "Component Tree" section.

### Layers (top → bottom)

| Layer | Contents |
|---|---|
| **Entry** | `main.tsx` — `createRoot`, `StrictMode`, `BrowserRouter`, imports `index.css` |
| **Auth Gate** | `App.tsx` — `onAuthStateChanged(auth, setUser)`; `undefined` → null (no flash); `null` → `/login`; `User` → `/`; passes `user` prop to `ChatPage` · `firebase.ts` — `initializeApp(VITE_*)`, exports `auth = getAuth(app)` |
| **Pages** | `LoginPage.tsx` — `signInWithPopup(auth, GoogleAuthProvider)` · `ChatPage.tsx` — state hub: `conversations: Conversation[]`, `activeId: string\|null`, `messages: Message[]`, `sending: boolean`, `drawerOpen: boolean`; handlers: `handleSend`, `handleDelete`, `handleNewChat`; optimistic UI |
| **Components** | `MessageList.tsx` — user bubbles right/blue, assistant left/grey, auto-scroll via ref · `MessageInput.tsx` — Enter=send, Shift+Enter=newline, disabled while sending, iOS safe-area · `HistoryDrawer.tsx` — fixed overlay z-10 + drawer z-11, `relativeTime()`, delete per item |
| **API Layer** | `api.ts` — `request<T>(path, options)`: auto Bearer token via `auth.currentUser.getIdToken()`, throws on !ok, undefined on 204 · `api.listConversations()`, `api.getMessages(id)`, `api.createConversation(msg)`, `api.sendMessage(id, msg)`, `api.deleteConversation(id)` |
| **Types** | `types.ts` — `interface Conversation { id, title, lastMessage, updatedAt }` · `interface Message { role, content, createdAt }` |
| **External** | Firebase Auth (Google OAuth) · BFF API (Cloud Run, `VITE_API_URL`) |

---

## Visual Style

Both diagrams use the existing doc styles:
- Layer headers: colored by responsibility (entry=slate, middleware=orange, routes=blue, providers=green, services=purple, external=red; frontend: entry=slate, auth=orange, pages=blue, components=indigo, api=green, types=slate, external=red)
- Module boxes: lighter shade of layer color with matching border
- Connectors: `↓` text between sequential layers; parallel columns (providers/services, pages/components) shown side-by-side via CSS grid
- Monospace font for code; small `font-size: 10-11px` for detail text

## Files Changed

- `docs/backend.html` — replace "Class & Type Architecture" section with layered diagram
- `docs/frontend.html` — add "Class & Module Architecture" section after "Component Tree"
