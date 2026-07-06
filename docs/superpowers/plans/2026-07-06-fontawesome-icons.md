# Font Awesome Icons Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all emoji, Unicode, and hand-rolled SVG icons in the frontend with Font Awesome Solid icons via `@fortawesome/react-fontawesome`.

**Architecture:** Each component imports only the icons it uses directly from `@fortawesome/free-solid-svg-icons` and renders them with the `<FontAwesomeIcon>` component. No global library registration, no centralized re-export file. This is a pure visual refactor — no behavior or layout changes.

**Tech Stack:** React 18, Vite, Tailwind CSS, Vitest, `@fortawesome/react-fontawesome`, `@fortawesome/free-solid-svg-icons`, `@fortawesome/fontawesome-svg-core`

## Global Constraints

- Free tier FA icons only (`@fortawesome/free-solid-svg-icons`)
- Per-component imports — do not use `library.add()` global registration
- No behavior changes — copy, send, delete, menu open/close logic untouched
- Tailwind `className` props control sizing (not the FA `size` prop), consistent with existing SVG approach
- Run `npm test` from `frontend/` after each task — existing tests must pass

---

### Task 1: Install dependencies and replace icons in MessageList.tsx

**Files:**
- Modify: `frontend/package.json` (install FA packages)
- Modify: `frontend/src/components/MessageList.tsx`
- Test: `frontend/src/components/MessageList.test.tsx` (existing — no new tests needed)

**Interfaces:**
- Produces: `<FontAwesomeIcon icon={faCheck}>` and `<FontAwesomeIcon icon={faCopy}>` in place of `CheckIcon` / `CopyIcon` SVG components

- [ ] **Step 1: Install Font Awesome packages**

Run from `frontend/`:
```bash
npm install @fortawesome/fontawesome-svg-core @fortawesome/free-solid-svg-icons @fortawesome/react-fontawesome
```
Expected: packages added to `dependencies` in `package.json`.

- [ ] **Step 2: Run existing tests to confirm baseline**

```bash
cd frontend && npm test
```
Expected: all tests pass before any code changes.

- [ ] **Step 3: Update MessageList.tsx imports**

Replace the top of `frontend/src/components/MessageList.tsx` (lines 1–5):

```tsx
import { useEffect, useRef, useState } from 'react'
import type { Message } from '../types'
import MarkdownMessage from './MarkdownMessage'
import SuggestionButtons from './SuggestionButtons'
import ThinkingProgress from './ThinkingProgress'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCheck, faCopy } from '@fortawesome/free-solid-svg-icons'
```

- [ ] **Step 4: Remove CheckIcon and CopyIcon SVG components**

Delete the entire `CheckIcon` function (lines 17–32) and the entire `CopyIcon` function (lines 34–50). The file should jump from the imports directly to the constants:

```tsx
const BALLOON_BASE = 'px-3.5 py-2.5 text-sm leading-relaxed break-words max-w-full'
```

- [ ] **Step 5: Replace icon usage in the copy button JSX**

Find the copy button JSX (inside the `{copiedIndex === i ? ... : ...}` block) and replace it:

```tsx
{copiedIndex === i ? (
  <>
    <FontAwesomeIcon icon={faCheck} className="w-3.5 h-3.5" />
    Copied!
  </>
) : (
  <>
    <FontAwesomeIcon icon={faCopy} className="w-3.5 h-3.5" />
    Copy
  </>
)}
```

- [ ] **Step 6: Run tests**

```bash
cd frontend && npm test
```
Expected: all tests pass. The existing test `'does not render suggestion buttons for messages without suggestions'` checks for `buttons[0]).toHaveTextContent('Copy')` — this still passes because the button text "Copy" is preserved.

- [ ] **Step 7: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/components/MessageList.tsx
git commit -m "feat: replace inline SVG icons in MessageList with Font Awesome"
```

---

### Task 2: Replace icons in ChatPage.tsx

**Files:**
- Modify: `frontend/src/pages/ChatPage.tsx`

**Interfaces:**
- Consumes: `@fortawesome/react-fontawesome`, `@fortawesome/free-solid-svg-icons` (installed in Task 1)
- Produces: `faBars` for the hamburger button, `faPenToSquare` for the new-chat button

- [ ] **Step 1: Run existing tests to confirm baseline**

```bash
cd frontend && npm test
```
Expected: all tests pass.

- [ ] **Step 2: Add FA imports to ChatPage.tsx**

At the top of `frontend/src/pages/ChatPage.tsx`, after the existing imports, add:

```tsx
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faBars, faPenToSquare } from '@fortawesome/free-solid-svg-icons'
```

- [ ] **Step 3: Replace hamburger menu character**

Find the button with `☰` text content and replace it:

```tsx
<button
  onClick={() => setDrawerOpen(true)}
  className="bg-transparent border-none text-xl cursor-pointer p-1 leading-none"
>
  <FontAwesomeIcon icon={faBars} />
</button>
```

- [ ] **Step 4: Replace pencil emoji**

Find the button with `✏️` text content and replace it:

```tsx
<button
  onClick={handleNewChat}
  disabled={sending}
  className="bg-transparent border-none text-xl cursor-pointer p-1 leading-none disabled:opacity-50 disabled:cursor-not-allowed"
>
  <FontAwesomeIcon icon={faPenToSquare} />
</button>
```

- [ ] **Step 5: Run tests**

```bash
cd frontend && npm test
```
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/ChatPage.tsx
git commit -m "feat: replace emoji icons in ChatPage header with Font Awesome"
```

---

### Task 3: Replace icons in HistoryDrawer.tsx

**Files:**
- Modify: `frontend/src/components/HistoryDrawer.tsx`

**Interfaces:**
- Consumes: `@fortawesome/react-fontawesome`, `@fortawesome/free-solid-svg-icons` (installed in Task 1)
- Produces: `faXmark` for close button, `faTrashCan` for delete button

- [ ] **Step 1: Run existing tests to confirm baseline**

```bash
cd frontend && npm test
```
Expected: all tests pass.

- [ ] **Step 2: Add FA imports to HistoryDrawer.tsx**

Replace the first line of `frontend/src/components/HistoryDrawer.tsx`:

```tsx
import type { Conversation } from '../types'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faXmark, faTrashCan } from '@fortawesome/free-solid-svg-icons'
```

- [ ] **Step 3: Replace close button character**

Find the button with `✕` text content and replace it:

```tsx
<button
  onClick={onClose}
  className="bg-transparent border-none text-xl cursor-pointer leading-none"
>
  <FontAwesomeIcon icon={faXmark} />
</button>
```

- [ ] **Step 4: Replace trash emoji**

Find the button with `🗑` text content and replace it:

```tsx
<button
  onClick={(e) => {
    e.stopPropagation()
    onDelete(c.id)
  }}
  className="bg-transparent border-none text-gray-300 text-base cursor-pointer p-1 ml-2 shrink-0 hover:text-red-400"
>
  <FontAwesomeIcon icon={faTrashCan} />
</button>
```

- [ ] **Step 5: Run tests**

```bash
cd frontend && npm test
```
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/HistoryDrawer.tsx
git commit -m "feat: replace emoji icons in HistoryDrawer with Font Awesome"
```

---

### Task 4: Replace send icon in MessageInput.tsx

**Files:**
- Modify: `frontend/src/components/MessageInput.tsx`

**Interfaces:**
- Consumes: `@fortawesome/react-fontawesome`, `@fortawesome/free-solid-svg-icons` (installed in Task 1)
- Produces: `faArrowUp` for the send button

- [ ] **Step 1: Run existing tests to confirm baseline**

```bash
cd frontend && npm test
```
Expected: all tests pass.

- [ ] **Step 2: Add FA imports to MessageInput.tsx**

Replace the first line of `frontend/src/components/MessageInput.tsx`:

```tsx
import { useState, useRef, useEffect } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faArrowUp } from '@fortawesome/free-solid-svg-icons'
```

- [ ] **Step 3: Replace up-arrow character in send button**

Find the send button with `↑` text content and replace it:

```tsx
<button
  onClick={handleSend}
  disabled={disabled || !text.trim()}
  className="w-10 h-10 rounded-full bg-[#0084ff] border-none text-white text-lg cursor-pointer shrink-0 self-end disabled:opacity-40 disabled:cursor-not-allowed"
>
  <FontAwesomeIcon icon={faArrowUp} />
</button>
```

- [ ] **Step 4: Run tests**

```bash
cd frontend && npm test
```
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/MessageInput.tsx
git commit -m "feat: replace arrow character in MessageInput send button with Font Awesome"
```

---

### Task 5: Replace coffee icon in MorningBriefingButton.tsx

**Files:**
- Modify: `frontend/src/components/MorningBriefingButton.tsx`

**Interfaces:**
- Consumes: `@fortawesome/react-fontawesome`, `@fortawesome/free-solid-svg-icons` (installed in Task 1)
- Produces: `faMugHot` in place of `☕` emoji

- [ ] **Step 1: Run existing tests to confirm baseline**

```bash
cd frontend && npm test
```
Expected: all tests pass.

- [ ] **Step 2: Add FA imports to MorningBriefingButton.tsx**

Replace the contents of `frontend/src/components/MorningBriefingButton.tsx` with:

```tsx
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faMugHot } from '@fortawesome/free-solid-svg-icons'

interface Props {
  onSend: (text: string) => void
  disabled: boolean
}

export default function MorningBriefingButton({ onSend, disabled }: Props) {
  return (
    <button
      onClick={() => !disabled && onSend('Give me a Hacker News Morning Coffee Briefing')}
      disabled={disabled}
      className="px-4 py-2 rounded-full text-sm border border-[#0084ff] text-[#0084ff] bg-transparent hover:bg-blue-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
    >
      <FontAwesomeIcon icon={faMugHot} className="mr-1" /> Morning Briefing
    </button>
  )
}
```

- [ ] **Step 3: Run tests**

```bash
cd frontend && npm test
```
Expected: all tests pass.

- [ ] **Step 4: Visual check**

Start the dev server (`npm run dev` from `frontend/`) and confirm:
- Header shows bars icon (hamburger), pen-to-square icon (new chat)
- History drawer shows X mark icon (close), trash can icon (delete)
- Send button shows up-arrow icon
- Morning Briefing button shows mug icon
- Copy button in message list shows copy/check icons

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/MorningBriefingButton.tsx
git commit -m "feat: replace coffee emoji in MorningBriefingButton with Font Awesome"
```
