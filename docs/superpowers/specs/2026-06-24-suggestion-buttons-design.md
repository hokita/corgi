# Suggestion Buttons Design

**Date:** 2026-06-24

## Overview

When the AI agent wants to ask a clarifying question or suggest next steps, it displays interactive buttons below its message. The user can tap a button to send it as a reply, or type their own message instead.

## User-Facing Behavior

- Buttons appear below assistant message bubbles (e.g., `Yes | No`, `Option A | Option B | Option C`)
- Tapping a button immediately sends its label as a user message
- After a reply is sent (button or typed), buttons become non-interactive:
  - The tapped button is highlighted (filled blue)
  - All other buttons are grayed out
  - If the user typed their own reply, all buttons are grayed out with no selection
- Suggestions are persisted in Firestore and restored when loading conversation history

## Architecture

### Backend

#### AI Provider Interface (`backend/src/providers/AIProvider.ts`)

The stream yield type widens to a discriminated union:

```typescript
export type StreamItem = string | { type: 'suggestions'; items: string[] }

interface AIProvider {
  chatStream(history: Message[], newMessage: string): AsyncIterable<StreamItem>
}
```

#### Gemini Provider (`backend/src/providers/GeminiProvider.ts`)

Registers a `suggest_options` function declaration with Gemini:

```typescript
{
  name: 'suggest_options',
  description: 'Call at the end of your response to suggest next steps or options for the user',
  parameters: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: { type: 'string' },
        description: '2–4 short button labels'
      }
    },
    required: ['items']
  }
}
```

In the streaming loop, text chunk parts yield as strings. When Gemini emits a `functionCall` part for `suggest_options`, the provider yields `{ type: 'suggestions', items }` instead.

#### SSE Protocol (`backend/src/models/api.ts`)

New event type added to the `SSEEvent` union:

```typescript
| { type: 'suggestions'; items: string[] }
```

Emitted by the route handler when it receives a suggestions item from the stream, before the `done` event.

#### Route Handler (`backend/src/routes/conversations.ts`)

Iterates the stream, differentiating strings (forwarded as `chunk` events) from suggestion events (forwarded as `suggestions` events and stored in a local variable). When the stream ends, the accumulated suggestions (if any) are passed to Firestore along with the message content.

#### Firestore (`backend/src/services/firestore.ts`)

Assistant messages gain an optional `suggestions` field:

```typescript
suggestions?: string[]
```

Stored and returned alongside `role`, `content`, and `createdAt`. The `MessageResponse` model in `api.ts` is updated accordingly.

### Frontend

#### Types (`frontend/src/types.ts`)

```typescript
export interface Message {
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  suggestions?: string[]  // assistant messages only
}
```

#### API Client (`frontend/src/api.ts`)

Stream callbacks gain:

```typescript
onSuggestions?: (items: string[]) => void
```

Called when the `suggestions` SSE event is received.

#### Chat Page (`frontend/src/pages/ChatPage.tsx`)

- Handles `onSuggestions`: attaches `items` to the last assistant message in state
- Passes `onSuggestionClick` down to `MessageList`, which calls the existing `handleSend(text)`

#### Message List (`frontend/src/components/MessageList.tsx`)

- Accepts `onSuggestionClick: (text: string) => void` prop
- After each assistant message bubble, if `message.suggestions` exists, renders `<SuggestionButtons>`
- Derives button state by inspecting `messages[i+1]`:
  - No next message → buttons active
  - Next message is user and content matches a suggestion → that item selected, rest grayed out
  - Next message is user but content doesn't match → all grayed out

#### SuggestionButtons Component (`frontend/src/components/SuggestionButtons.tsx`)

New component. Props:

```typescript
interface Props {
  items: string[]
  selectedItem?: string   // label of selected button (derived)
  disabled: boolean       // true when any next user message exists
  onSelect: (item: string) => void
}
```

Button states:
- **Active**: blue (`#0084ff`) outlined pill, clickable
- **Selected**: filled blue pill
- **Grayed out**: gray outlined pill, `pointer-events: none`

Renders as a flex row of pills, left-aligned, below the assistant bubble. Max 4 items.

## Data Flow

```
Gemini streams text chunks + optional functionCall(suggest_options)
  → GeminiProvider yields string | { type: 'suggestions', items }
  → Route handler emits chunk/suggestions SSE events
  → Frontend api.ts calls onChunk / onSuggestions callbacks
  → ChatPage attaches suggestions to last assistant message in state
  → MessageList renders SuggestionButtons below that message
  → User taps button → handleSend(label) → sends as user message
  → Buttons gray out, tapped button highlighted
```

## Files Changed

| File | Change |
|------|--------|
| `backend/src/providers/AIProvider.ts` | Widen stream yield type |
| `backend/src/providers/GeminiProvider.ts` | Register `suggest_options` tool, yield suggestions from stream |
| `backend/src/models/api.ts` | Add `suggestions` to `SSEEvent` and `MessageResponse` |
| `backend/src/routes/conversations.ts` | Handle suggestion stream items, pass to Firestore |
| `backend/src/services/firestore.ts` | Store and return `suggestions` on assistant messages |
| `frontend/src/types.ts` | Add `suggestions` to `Message` |
| `frontend/src/api.ts` | Add `onSuggestions` callback to stream handlers |
| `frontend/src/pages/ChatPage.tsx` | Handle suggestions event, pass click handler |
| `frontend/src/components/MessageList.tsx` | Render SuggestionButtons, derive button state |
| `frontend/src/components/SuggestionButtons.tsx` | New component |
