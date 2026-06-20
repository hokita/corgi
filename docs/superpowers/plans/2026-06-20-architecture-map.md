# Architecture Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a full-detail layered class/module relationship map to `docs/backend.html` (replacing the existing "Class & Type Architecture" section) and a new matching section to `docs/frontend.html`.

**Architecture:** Pure HTML/CSS inline in each doc. Swim-lane layers with nested module boxes, arch-specific CSS classes added to each file's existing `<style>` block. No external dependencies.

**Tech Stack:** Static HTML, inline CSS (existing doc style)

---

### Task 1: Add arch CSS classes to `docs/backend.html`

**Files:**
- Modify: `docs/backend.html` — `<style>` block (before the closing `</style>` tag)

- [ ] **Step 1: Insert arch CSS into the `<style>` block**

In `docs/backend.html`, find the line `@media (max-width: 600px)` and insert the following CSS block immediately before it:

```css
    .arch { display: flex; flex-direction: column; gap: 0; }
    .layer { border: 1px solid #e2e8f0; border-radius: 10px; background: white; overflow: hidden; }
    .layer-header { padding: 8px 16px; font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
    .layer-body { padding: 12px 16px; display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-start; }
    .arch-connector { text-align: center; color: #94a3b8; font-size: 18px; padding: 4px 0; }
    .layer-entry .layer-header { background: #f1f5f9; color: #475569; }
    .layer-middleware .layer-header { background: #fff7ed; color: #92400e; }
    .layer-routes .layer-header { background: #eff6ff; color: #1e40af; }
    .layer-models .layer-header { background: #f8fafc; color: #475569; }
    .layer-providers .layer-header { background: #f0fdf4; color: #166534; }
    .layer-services .layer-header { background: #fdf4ff; color: #6b21a8; }
    .layer-external .layer-header { background: #fef2f2; color: #991b1b; }
    .module { border-radius: 6px; padding: 8px 10px; font-size: 12px; min-width: 160px; flex: 1; }
    .module-name { font-weight: 700; font-family: 'SF Mono', 'Fira Code', monospace; font-size: 11px; margin-bottom: 6px; }
    .module-detail { font-size: 10px; color: #64748b; line-height: 1.7; }
    .module-detail code { font-size: 10px; }
    .module-gray { background: #f8fafc; border: 1px solid #e2e8f0; }
    .module-orange { background: #fff7ed; border: 1px solid #fed7aa; }
    .module-blue { background: #eff6ff; border: 1px solid #bfdbfe; }
    .module-slate { background: #f8fafc; border: 1px solid #cbd5e1; }
    .module-green { background: #f0fdf4; border: 1px solid #86efac; }
    .module-green-if { background: #dcfce7; border: 1px solid #4ade80; }
    .module-purple { background: #fdf4ff; border: 1px solid #d8b4fe; }
    .module-red { background: #fef2f2; border: 1px solid #fca5a5; }
    .type-tag { display: inline-block; font-size: 9px; font-family: monospace; padding: 1px 5px; border-radius: 3px; margin-right: 3px; margin-bottom: 2px; }
    .type-req { background: #dbeafe; color: #1e40af; }
    .type-res { background: #dcfce7; color: #166534; }
    .type-err { background: #fee2e2; color: #991b1b; }
```

---

### Task 2: Replace "Class & Type Architecture" section in `docs/backend.html`

**Files:**
- Modify: `docs/backend.html` — lines 116–201 (from `<!-- Class / Type Architecture -->` through the closing `</div>` before `<!-- Auth Middleware -->`)

- [ ] **Step 1: Replace the existing section**

Replace everything from `  <!-- Class / Type Architecture -->` up to (but not including) `  <!-- Auth Middleware -->` with:

```html
  <!-- Class & Module Architecture -->
  <h2>Class &amp; Module Architecture</h2>
  <div class="arch">

    <div class="layer layer-entry">
      <div class="layer-header">Entry Point</div>
      <div class="layer-body">
        <div class="module module-gray" style="max-width:200px;">
          <div class="module-name">src/index.ts</div>
          <div class="module-detail">Firebase Admin <code>initializeApp()</code><br>server <code>listen(PORT)</code></div>
        </div>
        <div class="module module-gray">
          <div class="module-name">src/app.ts — <code>createApp()</code></div>
          <div class="module-detail">
            CORS(<code>FRONTEND_URL</code>) · JSON body parser<br>
            <code>/healthz</code> endpoint<br>
            instantiates <code>new GeminiProvider(GEMINI_API_KEY)</code><br>
            mounts <code>authMiddleware</code> + <code>createConversationsRouter(ai)</code> at <code>/api/conversations</code>
          </div>
        </div>
      </div>
    </div>

    <div class="arch-connector">↓</div>

    <div class="layer layer-middleware">
      <div class="layer-header">Middleware</div>
      <div class="layer-body">
        <div class="module module-orange">
          <div class="module-name">middleware/auth.ts — <code>authMiddleware</code></div>
          <div class="module-detail">
            Extract <code>Bearer &lt;token&gt;</code> → <code>getAuth().verifyIdToken(token)</code><br>
            Guard <code>decoded.email</code> → check <code>ALLOWED_EMAIL</code><br>
            Set <code>req.uid = decoded.uid</code> · reject 401 on any failure
          </div>
        </div>
      </div>
    </div>

    <div class="arch-connector">↓</div>

    <div class="layer layer-routes">
      <div class="layer-header">Routes</div>
      <div class="layer-body">
        <div class="module module-blue">
          <div class="module-name">routes/conversations.ts — <code>createConversationsRouter(ai: AIProvider)</code></div>
          <div class="module-detail">
            <code>POST /</code> · <code>POST /:id/messages</code> · <code>GET /</code> · <code>GET /:id/messages</code> · <code>DELETE /:id</code><br>
            try/catch → 500 on all handlers · reads <code>req.uid</code> from middleware<br>
            maps <code>FirestoreMessage[]</code> → <code>Message[]</code> before calling <code>ai.chat()</code>
          </div>
        </div>
      </div>
    </div>

    <div class="arch-connector">↓</div>

    <div class="layer layer-models">
      <div class="layer-header">API Types — models/api.ts</div>
      <div class="layer-body" style="gap:6px;">
        <div class="module module-slate" style="flex:none;">
          <div class="module-detail">
            <span class="type-tag type-req">CreateConversationRequest</span>
            <span class="type-tag type-req">SendMessageRequest</span>
            <span class="type-tag type-res">CreateConversationResponse</span>
            <span class="type-tag type-res">SendMessageResponse</span>
            <span class="type-tag type-res">ConversationSummary</span>
            <span class="type-tag type-res">MessageResponse</span>
            <span class="type-tag type-err">ErrorResponse</span>
          </div>
        </div>
      </div>
    </div>

    <div class="arch-connector">↓</div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">

      <div class="arch">
        <div class="layer layer-providers">
          <div class="layer-header">Providers</div>
          <div class="layer-body" style="flex-direction:column;">
            <div class="module module-green-if">
              <div class="module-name">providers/AIProvider.ts</div>
              <div class="module-detail">
                <code>interface AIProvider</code><br>
                &nbsp;&nbsp;<code>chat(history: Message[], newMessage: string): Promise&lt;string&gt;</code><br><br>
                <code>type Message</code><br>
                &nbsp;&nbsp;<code>role: 'user' | 'assistant'</code><br>
                &nbsp;&nbsp;<code>content: string</code>
              </div>
            </div>
            <div class="arch-connector" style="font-size:13px;">↓ implements</div>
            <div class="module module-green">
              <div class="module-name">providers/GeminiProvider.ts</div>
              <div class="module-detail">
                <code>class GeminiProvider implements AIProvider</code><br>
                &nbsp;&nbsp;<code>private model: GenerativeModel</code><br>
                &nbsp;&nbsp;<code>constructor(apiKey: string)</code><br>
                &nbsp;&nbsp;&nbsp;&nbsp;→ <code>new GoogleGenerativeAI(apiKey)</code><br>
                &nbsp;&nbsp;&nbsp;&nbsp;→ <code>getGenerativeModel('gemini-2.5-flash-lite')</code><br>
                &nbsp;&nbsp;<code>chat(history, newMessage)</code><br>
                &nbsp;&nbsp;&nbsp;&nbsp;→ maps <code>'assistant'</code> → <code>'model'</code><br>
                &nbsp;&nbsp;&nbsp;&nbsp;→ <code>startChat()</code> + <code>sendMessage()</code>
              </div>
            </div>
          </div>
        </div>
        <div class="arch-connector">↓</div>
        <div class="layer layer-external">
          <div class="layer-header">External — Gemini API</div>
          <div class="layer-body">
            <div class="module module-red">
              <div class="module-name">@google/generative-ai</div>
              <div class="module-detail"><code>gemini-2.5-flash-lite</code> model</div>
            </div>
          </div>
        </div>
      </div>

      <div class="arch">
        <div class="layer layer-services">
          <div class="layer-header">Services</div>
          <div class="layer-body" style="flex-direction:column;">
            <div class="module module-purple">
              <div class="module-name">services/firestore.ts</div>
              <div class="module-detail">
                <code>interface ConversationDoc</code> — <code>id uid title lastMessage createdAt updatedAt</code><br>
                <code>interface FirestoreMessage</code> — <code>role content createdAt</code><br><br>
                <code>createConversation(uid, title)</code><br>
                <code>getConversation(id, uid)</code><br>
                <code>listConversations(uid)</code><br>
                <code>addMessage(id, role, content)</code><br>
                <code>getMessages(id)</code> → <code>FirestoreMessage[]</code><br>
                <code>updateConversationLastMessage(id, msg)</code><br>
                <code>deleteConversation(id)</code> — batch delete
              </div>
            </div>
          </div>
        </div>
        <div class="arch-connector">↓</div>
        <div class="layer layer-external">
          <div class="layer-header">External — Firestore</div>
          <div class="layer-body">
            <div class="module module-red">
              <div class="module-name">firebase-admin/firestore</div>
              <div class="module-detail">
                <code>conversations/{id}</code><br>
                <code>conversations/{id}/messages/{id}</code>
              </div>
            </div>
          </div>
        </div>
      </div>

    </div>
  </div>
  <p style="margin-top:8px;font-size:11px;color:#94a3b8;">↓ = request flow &nbsp;·&nbsp; parallel columns = independent subsystems used by routes</p>

```

---

### Task 3: Add arch CSS classes to `docs/frontend.html`

**Files:**
- Modify: `docs/frontend.html` — `<style>` block

- [ ] **Step 1: Insert arch CSS into the `<style>` block**

In `docs/frontend.html`, find the line `@media (max-width: 600px)` and insert the following CSS block immediately before it:

```css
    .arch { display: flex; flex-direction: column; gap: 0; }
    .layer { border: 1px solid #e2e8f0; border-radius: 10px; background: white; overflow: hidden; }
    .layer-header { padding: 8px 16px; font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
    .layer-body { padding: 12px 16px; display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-start; }
    .arch-connector { text-align: center; color: #94a3b8; font-size: 18px; padding: 4px 0; }
    .layer-entry .layer-header { background: #f1f5f9; color: #475569; }
    .layer-auth .layer-header { background: #fff7ed; color: #92400e; }
    .layer-pages .layer-header { background: #eff6ff; color: #1e40af; }
    .layer-components .layer-header { background: #eef2ff; color: #3730a3; }
    .layer-api .layer-header { background: #f0fdf4; color: #166534; }
    .layer-types .layer-header { background: #f8fafc; color: #475569; }
    .layer-external .layer-header { background: #fef2f2; color: #991b1b; }
    .module { border-radius: 6px; padding: 8px 10px; font-size: 12px; min-width: 160px; flex: 1; }
    .module-name { font-weight: 700; font-family: 'SF Mono', 'Fira Code', monospace; font-size: 11px; margin-bottom: 6px; }
    .module-detail { font-size: 10px; color: #64748b; line-height: 1.7; }
    .module-detail code { font-size: 10px; }
    .module-gray { background: #f8fafc; border: 1px solid #e2e8f0; }
    .module-orange { background: #fff7ed; border: 1px solid #fed7aa; }
    .module-blue { background: #eff6ff; border: 1px solid #bfdbfe; }
    .module-slate { background: #f8fafc; border: 1px solid #cbd5e1; }
    .module-green { background: #f0fdf4; border: 1px solid #86efac; }
    .module-indigo { background: #eef2ff; border: 1px solid #a5b4fc; }
    .module-red { background: #fef2f2; border: 1px solid #fca5a5; }
    .type-tag { display: inline-block; font-size: 9px; font-family: monospace; padding: 1px 5px; border-radius: 3px; margin-right: 3px; margin-bottom: 2px; }
    .type-req { background: #dbeafe; color: #1e40af; }
```

---

### Task 4: Add "Class & Module Architecture" section to `docs/frontend.html`

**Files:**
- Modify: `docs/frontend.html` — after the `<!-- Component Tree -->` section, before `<!-- State -->`

- [ ] **Step 1: Insert the new section**

Find `  <!-- State -->` in `docs/frontend.html` and insert the following block immediately before it:

```html
  <!-- Class & Module Architecture -->
  <h2>Class &amp; Module Architecture</h2>
  <div class="arch">

    <div class="layer layer-entry">
      <div class="layer-header">Entry</div>
      <div class="layer-body">
        <div class="module module-gray">
          <div class="module-name">src/main.tsx</div>
          <div class="module-detail">
            <code>createRoot()</code> · <code>StrictMode</code> · <code>BrowserRouter</code><br>
            imports <code>index.css</code> (<code>@import "tailwindcss"</code>)
          </div>
        </div>
      </div>
    </div>

    <div class="arch-connector">↓</div>

    <div class="layer layer-auth">
      <div class="layer-header">Auth Gate</div>
      <div class="layer-body">
        <div class="module module-orange">
          <div class="module-name">src/App.tsx</div>
          <div class="module-detail">
            <code>onAuthStateChanged(auth, setUser)</code><br>
            <code>undefined</code> → return null (prevents screen flash)<br>
            <code>null</code> → <code>/login</code> · <code>User</code> → <code>/</code><br>
            passes <code>user: User</code> prop to <code>ChatPage</code>
          </div>
        </div>
        <div class="module module-orange">
          <div class="module-name">src/firebase.ts</div>
          <div class="module-detail">
            <code>initializeApp({ VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_PROJECT_ID })</code><br>
            exports <code>auth = getAuth(app)</code>
          </div>
        </div>
      </div>
    </div>

    <div class="arch-connector">↓</div>

    <div class="layer layer-pages">
      <div class="layer-header">Pages</div>
      <div class="layer-body">
        <div class="module module-blue" style="max-width:220px;">
          <div class="module-name">pages/LoginPage.tsx</div>
          <div class="module-detail">
            <code>signInWithPopup(auth, new GoogleAuthProvider())</code><br>
            "corgi" h1 · Sign in with Google button
          </div>
        </div>
        <div class="module module-blue">
          <div class="module-name">pages/ChatPage.tsx — state hub</div>
          <div class="module-detail">
            state: <code>conversations: Conversation[]</code> · <code>activeId: string | null</code> · <code>messages: Message[]</code> · <code>sending: boolean</code> · <code>drawerOpen: boolean</code><br>
            <code>handleSend(text)</code> — new vs existing conversation · optimistic UI<br>
            <code>handleDelete(id)</code> · <code>handleNewChat()</code>
          </div>
        </div>
      </div>
    </div>

    <div class="arch-connector">↓</div>

    <div class="layer layer-components">
      <div class="layer-header">Components</div>
      <div class="layer-body">
        <div class="module module-indigo">
          <div class="module-name">components/MessageList.tsx</div>
          <div class="module-detail">
            props: <code>messages: Message[]</code><br>
            user bubbles: right/blue · assistant: left/grey<br>
            chat-tail border-radius · auto-scroll to bottom via ref
          </div>
        </div>
        <div class="module module-indigo">
          <div class="module-name">components/MessageInput.tsx</div>
          <div class="module-detail">
            props: <code>onSend(text: string)</code> · <code>disabled: boolean</code><br>
            Enter=send · Shift+Enter=newline<br>
            disabled while AI responds · iOS <code>safe-area-inset-bottom</code> · re-focus after reply
          </div>
        </div>
        <div class="module module-indigo">
          <div class="module-name">components/HistoryDrawer.tsx</div>
          <div class="module-detail">
            props: <code>conversations: Conversation[]</code> · <code>activeId</code> · <code>onSelect</code> · <code>onDelete</code> · <code>onNewChat</code> · <code>onClose</code><br>
            fixed overlay z-10 (click=close) + drawer z-11 (280px, left slide)<br>
            <code>relativeTime()</code> helper · delete per item
          </div>
        </div>
      </div>
    </div>

    <div class="arch-connector">↓</div>

    <div class="layer layer-api">
      <div class="layer-header">API Layer</div>
      <div class="layer-body">
        <div class="module module-green">
          <div class="module-name">src/api.ts</div>
          <div class="module-detail">
            <code>request&lt;T&gt;(path, options?)</code> — <code>auth.currentUser.getIdToken()</code> auto-attached as Bearer · throws on <code>!res.ok</code> · <code>undefined</code> on 204<br>
            <code>api.listConversations()</code> → <code>Conversation[]</code><br>
            <code>api.getMessages(id)</code> → <code>Message[]</code><br>
            <code>api.createConversation(message)</code> → <code>{ conversationId, title, assistantMessage }</code><br>
            <code>api.sendMessage(id, message)</code> → <code>{ assistantMessage }</code><br>
            <code>api.deleteConversation(id)</code> → <code>void</code>
          </div>
        </div>
      </div>
    </div>

    <div class="arch-connector">↓</div>

    <div class="layer layer-types">
      <div class="layer-header">Types — src/types.ts</div>
      <div class="layer-body" style="gap:6px;">
        <div class="module module-slate" style="flex:none;">
          <div class="module-detail">
            <span class="type-tag type-req">Conversation</span> <code style="font-size:10px;">{ id, title, lastMessage, updatedAt: string }</code><br>
            <span class="type-tag type-req">Message</span> <code style="font-size:10px;">{ role: 'user'|'assistant', content, createdAt: string }</code>
          </div>
        </div>
      </div>
    </div>

    <div class="arch-connector">↓</div>

    <div class="layer layer-external">
      <div class="layer-header">External</div>
      <div class="layer-body">
        <div class="module module-red">
          <div class="module-name">Firebase Auth</div>
          <div class="module-detail">Google OAuth · <code>firebase 10</code> · session persisted by SDK</div>
        </div>
        <div class="module module-red">
          <div class="module-name">BFF API</div>
          <div class="module-detail"><code>VITE_API_URL</code> · Cloud Run (prod) · <code>localhost:8080</code> (dev)</div>
        </div>
      </div>
    </div>

  </div>
  <p style="margin-top:8px;font-size:11px;color:#94a3b8;">↓ = render/call flow from entry to external dependencies</p>

```

---

### Task 5: Commit

**Files:** `docs/backend.html`, `docs/frontend.html`

- [ ] **Step 1: Verify both pages look correct in a browser**

Open `docs/backend.html` and `docs/frontend.html` in a browser (drag-and-drop or `open docs/backend.html`). Confirm:
- Backend: layered diagram shows Entry Point → Middleware → Routes → API Types → Providers/Services columns → External rows
- Frontend: layered diagram shows Entry → Auth Gate → Pages → Components → API Layer → Types → External
- All module boxes have correct colors matching their layer
- No layout overflow or broken boxes

- [ ] **Step 2: Commit**

```bash
git add docs/backend.html docs/frontend.html
git commit -m "docs: add layered class/module architecture maps to backend and frontend docs"
```
