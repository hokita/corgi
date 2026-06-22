# SSE Streaming Design

**Date:** 2026-06-22
**Status:** Approved

## Overview

Replace the current blocking request/response pattern with SSE streaming so users see AI response tokens appear progressively, matching the UX of ChatGPT, Claude, and Gemini.

Both message endpoints (`POST /api/conversations` and `POST /api/conversations/:id/messages`) change their response from JSON to `text/event-stream`. Auth flow is unchanged — Firebase JWT is sent as `Authorization: Bearer <token>` in the request header.

## SSE Event Protocol

Each event is a JSON object with a `type` field, sent as `data: <json>\n\n`.

### `POST /api/conversations/:id/messages`

```
data: {"type":"chunk","text":"Hello"}\n\n
data: {"type":"chunk","text":" world"}\n\n
data: {"type":"done"}\n\n
```

### `POST /api/conversations` (new conversation)

Emits a `meta` event first to deliver `conversationId` and `title`, then streams chunks:

```
data: {"type":"meta","conversationId":"abc123","title":"..."}\n\n
data: {"type":"chunk","text":"Hello"}\n\n
data: {"type":"done"}\n\n
```

### Error events

If an error occurs **before streaming starts** (e.g. 404, 400), respond with HTTP 4xx and a JSON body as today — no SSE headers are set.

If an error occurs **mid-stream** (after headers are sent), emit an error event and close:

```
data: {"type":"error","message":"Internal server error"}\n\n
```

## Backend Changes

### `AIProvider` interface

Add a streaming method. The non-streaming `chat()` method is removed since all message flows will stream.

```typescript
export interface AIProvider {
  chatStream(history: Message[], newMessage: string): AsyncIterable<string>
}
```

### `GeminiProvider`

Implement `chatStream` using `chat.sendMessageStream()` from the Gemini SDK, yielding each text chunk:

```typescript
async *chatStream(history: Message[], newMessage: string): AsyncIterable<string> {
  const chat = this.model.startChat({ history: /* mapped history */ })
  const result = await chat.sendMessageStream(newMessage)
  for await (const chunk of result.stream) {
    const text = chunk.text()
    if (text) yield text
  }
}
```

### Routes

Both POST endpoints:

1. Validate the request body (return 4xx JSON if invalid — before SSE headers).
2. Set SSE response headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`.
3. Save the user message to Firestore.
4. For `POST /`, create the conversation and emit the `meta` event.
5. Call `ai.chatStream()`, writing each chunk as a `chunk` event and accumulating full text.
6. On stream end, save the complete assistant message to Firestore and emit `done`.
7. On stream error, emit `error` and call `res.end()`.

## Frontend Changes

### `api.ts`

Replace `createConversation` and `sendMessage` with streaming variants:

```typescript
export interface StreamCallbacks {
  onMeta?: (meta: { conversationId: string; title: string }) => void
  onChunk: (text: string) => void
  onDone: () => void
  onError: (message: string) => void
}

createConversation(message: string, callbacks: StreamCallbacks): Promise<void>
sendMessage(conversationId: string, message: string, callbacks: StreamCallbacks): Promise<void>
```

Internally both functions use `fetch` → `response.body.getReader()` → `TextDecoder` to parse the SSE line stream and dispatch events to the appropriate callback.

### `ChatPage.tsx`

On send:

1. Immediately append the user message to state.
2. Add an empty assistant message placeholder.
3. Call the streaming API:
   - `onMeta`: set `activeId`, add conversation to the list.
   - `onChunk`: append text to the placeholder message in state.
   - `onDone`: update the conversation's `lastMessage` in state.
   - `onError`: remove the placeholder, show an error.

## Data Flow

```
User types → handleSend()
  → append user message to state
  → append empty assistant placeholder
  → fetch POST (SSE)
      → [meta event]  → setActiveId, add to conversations list
      → [chunk event] → append text to placeholder
      → [done event]  → finalize lastMessage in conversations list
      → [error event] → remove placeholder, show error
```

## Testing

- **Backend unit tests**: mock `AIProvider.chatStream` as an async generator yielding known chunks; assert SSE lines written to the response match the expected protocol.
- **Frontend unit tests**: mock `fetch` to return a readable stream with known SSE events; assert state updates in `ChatPage` match expected sequence.
- **Manual smoke test**: send a message and verify tokens appear progressively in the UI.
