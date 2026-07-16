# Typing Indicator Design

**Date:** 2026-07-17

## Overview

The assistant's `suggest_options` function call (see [Suggestion Buttons Design](2026-06-24-suggestion-buttons-design.md)) is typically emitted at the end of the model's turn, but the `suggestions` SSE event only reaches the frontend after all text chunks have streamed. This leaves a gap where the assistant's message bubble looks fully rendered but nothing on screen indicates that suggestion buttons (or anything else) might still be coming.

This adds a bouncing-dots typing indicator that's visible from the moment the reply starts streaming until the turn is fully resolved (suggestions attached, or `done` with none), closing that gap without any backend changes.

## User-Facing Behavior

- As soon as the first text chunk of an assistant reply arrives, a small gray pill with three bouncing dots appears below the message bubble, in the same spot suggestion buttons would occupy.
- It stays visible while text continues streaming and through any lull afterward (e.g. while Gemini is still deciding whether to call `suggest_options`).
- It disappears the instant one of two things happens:
  - Suggestion buttons arrive → they take its place.
  - The turn ends with no suggestions → it's removed with nothing in its place.
- The existing pre-text status line (`ThinkingProgress`, e.g. "Analyzing your message...") is unchanged and still only shows before the first chunk arrives (`message.content === ''`). The handoff is: status text → bouncing dots → final state.

## Architecture

### `TypingIndicator` Component (`frontend/src/components/TypingIndicator.tsx`)

New, no props. Renders three dots in a gray pill bubble matching the existing assistant-bubble visual language (`bg-gray-200`, rounded), animated with Tailwind's `animate-bounce` and a staggered `animation-delay` per dot (e.g. 0ms, 150ms, 300ms) so they bounce in sequence.

### `MessageList` (`frontend/src/components/MessageList.tsx`)

- Accepts a new `sending: boolean` prop.
- Renders `<TypingIndicator />` in the slot immediately after the message bubble (same position `SuggestionButtons` renders in) when:

```
m.role === 'assistant' && isLastAssistant && sending && m.content !== '' && !m.suggestions
```

- This condition is mutually exclusive with both `ThinkingProgress` (requires `m.content === ''`) and `SuggestionButtons` (requires `m.suggestions` to be set), so exactly one of the three (or none, once the turn is fully done) renders in that region at a time.

### `ChatPage` (`frontend/src/pages/ChatPage.tsx`)

- Passes the existing `sending` value (already returned by `useChatStream`) down to `MessageList` as the new prop.

## Data Flow

```
useChatStream exposes `sending` (already tracked, previously unused by MessageList)
  → ChatPage passes `sending` to MessageList
  → MessageList shows TypingIndicator for the last assistant message while:
      sending && message has content && no suggestions yet
  → Indicator swaps out for SuggestionButtons (onSuggestions fires) or disappears (onDone fires)
```

## Non-Goals

- No new backend event or timing signal — Gemini doesn't stream partial function calls, so there's no earlier point at which the backend could know a `suggest_options` call is coming. A frontend silence-detection timer to isolate just the "tail gap" was considered and rejected as unnecessary complexity: showing the indicator continuously from the first chunk already covers the gap and requires no timers.

## Files Changed

| File | Change |
|------|--------|
| `frontend/src/components/TypingIndicator.tsx` | New component |
| `frontend/src/components/TypingIndicator.test.tsx` | New tests |
| `frontend/src/components/MessageList.tsx` | Add `sending` prop, render `TypingIndicator` |
| `frontend/src/components/MessageList.test.tsx` | Update/add tests for new indicator behavior |
| `frontend/src/pages/ChatPage.tsx` | Pass `sending` to `MessageList` |
