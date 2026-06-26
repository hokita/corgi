# English Learning Feature Design

**Date:** 2026-06-27  
**Status:** Approved

## Overview

When a user sends a message in English, the chat model silently analyzes it for grammar mistakes, unnatural phrasing, wrong prepositions, article errors, or word choice issues. If the mistake is worth reviewing later, the model calls a `save_english_mistake` function as part of its normal response. The backend intercepts this function call, saves the record to Firestore, and emits a progress event so the frontend can show the user that a learning point was captured. The model never mentions the correction in its chat reply unless the user explicitly asks.

## Data Layer

**Firestore collection: `english_mistakes`**

Top-level collection (consistent with `conversations`). One document per saved learning point.

| Field | Type | Description |
|---|---|---|
| `uid` | string | Owner — used to query all mistakes by user |
| `conversationId` | string | Traceability back to the conversation |
| `originalText` | string | The user's original phrasing |
| `correctedText` | string | The improved version |
| `category` | string | `'grammar'` \| `'word-choice'` \| `'preposition'` \| `'article'` \| `'phrasing'` |
| `severity` | string | `'low'` \| `'medium'` \| `'high'` |
| `patternKey` | string | Reusable pattern identifier e.g. `by_gerund_for_method` |
| `createdAt` | Timestamp | When the record was saved |

A Firestore composite index on `(uid ASC, createdAt DESC)` is required for future review page queries.

## Backend Architecture

### `AIProvider.ts`

Extend `StreamItem` union with a new type:

```ts
| {
    type: 'save_english_mistake'
    data: {
      originalText: string
      correctedText: string
      category: string
      severity: string
      patternKey: string
    }
  }
```

### `GeminiProvider.ts`

Two changes:

1. **Add `save_english_mistake` function declaration** alongside the existing `suggest_options` tool. The function takes `originalText`, `correctedText`, `category`, `severity`, and `patternKey` as required parameters.

2. **Yield the new stream item** when the function call is detected mid-stream (same pattern as `suggest_options`). The provider does not save to Firestore — it yields and lets the route handler decide.

3. **Update the system prompt** to instruct the model to:
   - Analyze every user message for English learning points
   - Call `save_english_mistake` only for genuinely useful points (not trivial typos or low-value corrections)
   - Never mention the correction in the chat reply unless the user explicitly asks

### `conversations.ts`

In the SSE streaming loop, handle the new stream item:
1. Call `db.saveEnglishMistake(uid, conversationId, data)`
2. Emit `{ type: 'progress', message: 'Saving learning point...' }` to the client

The existing `progress` SSE event is also emitted at the start of every request (`'Analyzing...'`) and on completion (`'Done'`) so the frontend always has a full progress sequence.

### `firestore.ts`

Add `saveEnglishMistake(uid: string, conversationId: string, data: EnglishMistakeData): Promise<void>` and export the `EnglishMistakeData` interface.

### `api.ts`

Add `{ type: 'progress'; message: string }` to the `SSEEvent` union.

## Frontend Architecture

### SSE event handling (`api.ts`)

Parse and surface `progress` events to the caller alongside existing `chunk`, `suggestions`, and `done` events.

### State management (`ChatPage.tsx`)

Add `progressSteps: string[]` to the in-flight message state. Append each `progress` message as events arrive.

### Progress UI (`ThinkingProgress.tsx` — new component)

Rendered above the streaming assistant text for the in-flight message. Shows steps as they arrive:

```
⚙ Analyzing...
📝 Saving learning point...     ← only if function fires
✓ Done
```

Collapses (fades out or minimizes) once the `done` event is received, keeping the chat view clean.

### `MessageList.tsx`

Pass `progressSteps` to the in-flight message rendering so `ThinkingProgress` receives its data.

## Data Flow

```
User sends message
  → Backend: emit progress SSE "Analyzing..."
  → Gemini streams response (with save_english_mistake + suggest_options tools)
      → If function call detected:
          → Backend: save to english_mistakes collection
          → Backend: emit progress SSE "Saving learning point..."
      → Text chunks streamed as usual
      → suggest_options call handled as usual
  → Backend: emit progress SSE "Done"
  → Backend: emit SSE "done"
  → Frontend: progress area collapses, response is fully visible
```

## What Is Not In Scope

- A review page / UI for browsing saved mistakes (future feature)
- Deduplication of identical `patternKey` mistakes
- Per-conversation mistake counts or summaries
