# New Chat Button in Header

## Overview

Add a compose button (✏️) to the header of `ChatPage` so users can start a new conversation without opening the history drawer.

## Placement

The header currently uses `justify-between` with three elements: hamburger (left), "corgi" title (center), `UserMenu` (right). The new button is added to the right side by wrapping the compose button and `UserMenu` in a flex group:

```
[ ☰ ]   corgi   [ ✏️ ] [ UserMenu ]
```

## Behavior

- Clicking the button calls the existing `handleNewChat()`, which resets `activeId` to `null` and `messages` to `[]`.
- The button is disabled while `sending === true` to prevent starting a new chat mid-stream.
- Always visible — shown on both the empty state and during active conversations.

## Styling

- Matches existing header button style: `bg-transparent border-none cursor-pointer`.
- Icon: ✏️ emoji, consistent with the emoji-based icon set already used (☰, ✕).
- Disabled state: `opacity-50 cursor-not-allowed` when `sending` is true.

## Files Changed

- `frontend/src/pages/ChatPage.tsx` — wrap right-side header controls in a flex group, add compose button.

## Out of Scope

- No new logic or state; `handleNewChat` already exists.
- No backend changes.
