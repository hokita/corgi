# Font Awesome Icons Migration Design

**Date:** 2026-07-06
**Status:** Approved

## Overview

Replace all ad-hoc icon representations (emoji, Unicode characters, hand-rolled SVGs) in the frontend with Font Awesome Solid icons via the official React package. This gives the app a consistent, professional icon style and removes fragile inline SVG definitions.

## Dependencies

Three packages to add:

```
@fortawesome/fontawesome-svg-core
@fortawesome/free-solid-svg-icons
@fortawesome/react-fontawesome
```

Free tier, no license required. Tree-shaking works automatically with Vite — only imported icons are bundled.

## Icon Mapping

| File | Current symbol | FA icon | Variable |
|---|---|---|---|
| `ChatPage.tsx` | `☰` (hamburger) | Bars | `faBars` |
| `ChatPage.tsx` | `✏️` (new chat) | Pen to square | `faPenToSquare` |
| `HistoryDrawer.tsx` | `✕` (close) | X mark | `faXmark` |
| `HistoryDrawer.tsx` | `🗑` (delete) | Trash can | `faTrashCan` |
| `MessageInput.tsx` | `↑` (send) | Arrow up | `faArrowUp` |
| `MorningBriefingButton.tsx` | `☕` (coffee) | Mug hot | `faMugHot` |
| `MessageList.tsx` | inline SVG `CopyIcon` | Copy | `faCopy` |
| `MessageList.tsx` | inline SVG `CheckIcon` | Check | `faCheck` |

## Approach

**Per-component imports (Approach A).** Each component imports only the icons it uses directly from `@fortawesome/free-solid-svg-icons` and renders them with `<FontAwesomeIcon>`. No global library registration, no centralized re-export file.

## Sizing

Use the `className` prop on `<FontAwesomeIcon>` to match existing sizes:
- Copy/check icons in MessageList: `className="w-3.5 h-3.5"`
- Buttons in header/drawer (currently `text-xl`): use `size="lg"` or equivalent class

## Files Changed

- `MessageList.tsx` — remove `CheckIcon` and `CopyIcon` SVG components; import `faCheck`, `faCopy`
- `ChatPage.tsx` — import `faBars`, `faPenToSquare`
- `HistoryDrawer.tsx` — import `faXmark`, `faTrashCan`
- `MessageInput.tsx` — import `faArrowUp`
- `MorningBriefingButton.tsx` — import `faMugHot`

No new files. No changes to styles, layouts, or behavior.

## Testing

Existing tests do not rely on icon rendering content, so no test changes are expected. Visual check in the browser after implementation to confirm icons render at appropriate sizes and alignment.
