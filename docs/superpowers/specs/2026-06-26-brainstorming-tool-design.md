# Brainstorming Tool Design

**Date:** 2026-06-26

## Overview

Add a `brainstorm_ideas` Gemini function call tool that the AI invokes when it detects brainstorming intent. The tool returns idea clusters (groups of related ideas), which the frontend renders as cards. Cluster labels are automatically converted into suggestion buttons so the user can drill deeper into any cluster.

---

## Approach

A new standalone function declaration `brainstorm_ideas` alongside the existing `suggest_options`. The AI decides when to call it based on the tool description and system instruction. No UI mode toggle — intent detection is AI-driven.

---

## Backend

### Function declaration (`GeminiProvider.ts`)

Add `brainstormIdeasTool` with the following schema:

```ts
{
  name: 'brainstorm_ideas',
  description:
    'Call when the user is exploring, generating, or brainstorming ideas. Do NOT call for factual questions, weather, or conversational messages.',
  parameters: {
    type: OBJECT,
    properties: {
      clusters: {
        type: ARRAY,
        items: {
          type: OBJECT,
          properties: {
            label: { type: STRING },
            ideas: {
              type: ARRAY,
              items: {
                type: OBJECT,
                properties: {
                  label: { type: STRING },
                  description: { type: STRING },
                },
                required: ['label', 'description'],
              },
            },
          },
          required: ['label', 'ideas'],
        },
      },
    },
    required: ['clusters'],
  },
}
```

Add to `tools` array alongside `suggestOptionsTool`. Update the system instruction:

> "When the user is exploring, generating, or brainstorming ideas, call `brainstorm_ideas` with 2–4 clusters of related ideas (2–4 ideas each). When it would help the user choose a next step, call `suggest_options` at the end of your response."

When the AI calls `brainstorm_ideas`, `GeminiProvider` yields two `StreamItem`s automatically:
1. `{ type: 'brainstorm', clusters: [...] }` — the structured cluster data
2. `{ type: 'suggestions', items: [clusterLabel1, clusterLabel2, ...] }` — cluster labels as buttons

### StreamItem (`AIProvider.ts`)

```ts
export type StreamItem =
  | string
  | { type: 'suggestions'; items: string[] }
  | { type: 'brainstorm'; clusters: { label: string; ideas: { label: string; description: string }[] }[] }
```

### SSE event (`models/api.ts`)

```ts
export type SSEEvent =
  | { type: 'meta'; conversationId: string; title: string }
  | { type: 'chunk'; text: string }
  | { type: 'suggestions'; items: string[] }
  | { type: 'brainstorm'; clusters: { label: string; ideas: { label: string; description: string }[] }[] }
  | { type: 'done' }
  | { type: 'error'; message: string }
```

### Conversations route (`conversations.ts`)

Handle the `brainstorm` SSE event the same way as `suggestions` — write the event to the SSE stream and persist `clusters` alongside the assistant message in Firestore.

### Firestore (`services/firestore.ts`)

`addMessage` accepts an optional `clusters` field and persists it on the message document. `getMessages` returns `clusters` when present.

---

## Frontend

### `types.ts`

```ts
export interface IdeaCluster {
  label: string
  ideas: { label: string; description: string }[]
}

export interface Message {
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  suggestions?: string[]
  clusters?: IdeaCluster[]
}
```

### `BrainstormClusters` component

New component (`components/BrainstormClusters.tsx`). Receives `clusters: IdeaCluster[]`. Renders one card per cluster: cluster label as heading, each idea as `**label** — description` row.

### `MessageList`

When rendering the last assistant message, if `clusters` is present, render `BrainstormClusters` above `SuggestionButtons`. Both are shown together — clusters as the visual content, suggestion buttons as the navigation.

### `ChatPage`

Handle the `brainstorm` SSE event: set `clusters` on the last message in state (same pattern as `suggestions`).

### `api.ts`

Parse the `brainstorm` SSE event type and call an `onBrainstorm` callback (same pattern as `onSuggestions`).

---

## Error handling

- If `brainstorm_ideas` is called with malformed args (missing `clusters`), the item is silently skipped — no crash, no partial render.
- If the AI calls both `brainstorm_ideas` and `suggest_options` in the same turn, `brainstorm_ideas` takes priority: its cluster labels are used as the suggestion buttons, and the `suggest_options` call is ignored.

---

## Testing

- `GeminiProvider.test.ts`: add a test case where the mock stream yields a `brainstorm_ideas` function call; assert that `brainstorm` and `suggestions` (cluster labels) StreamItems are emitted.
- `BrainstormClusters.test.tsx`: render with sample clusters, assert cards and idea rows appear.
- `MessageList.test.tsx`: assert `BrainstormClusters` renders when message has `clusters`.
- `api.test.ts`: assert `onBrainstorm` callback is called when a `brainstorm` SSE event arrives.
