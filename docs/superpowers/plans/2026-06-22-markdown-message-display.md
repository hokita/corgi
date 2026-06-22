# Markdown Message Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render assistant (LLM) messages as styled markdown inside the chat UI while leaving user messages as plain text.

**Architecture:** A new `MarkdownMessage` component wraps `react-markdown` with a custom `components` prop that maps each markdown element to Tailwind-styled equivalents. `MessageList` uses it for `role === 'assistant'` messages only. No backend changes.

**Tech Stack:** React 18, TypeScript, Tailwind CSS v4, Vitest, @testing-library/react, react-markdown v9, remark-gfm

## Global Constraints

- Tailwind CSS v4 — use class names directly, no `@apply`
- Vitest + jsdom test environment, `@testing-library/react` for component tests
- No syntax highlighting library — use Tailwind classes only
- `remark-gfm` required for tables, strikethrough, task lists
- User messages must NOT be processed through markdown

---

### Task 1: MarkdownMessage component

**Files:**
- Create: `frontend/src/components/MarkdownMessage.tsx`
- Create: `frontend/src/components/MarkdownMessage.test.tsx`

**Interfaces:**
- Produces: `MarkdownMessage({ content: string }): JSX.Element` — imported by `MessageList` in Task 2

- [ ] **Step 1: Install dependencies**

```bash
cd frontend
npm install react-markdown remark-gfm
```

Expected: `react-markdown` and `remark-gfm` appear in `package.json` dependencies.

- [ ] **Step 2: Write the failing tests**

Create `frontend/src/components/MarkdownMessage.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import MarkdownMessage from './MarkdownMessage'

describe('MarkdownMessage', () => {
  it('renders plain text content', () => {
    render(<MarkdownMessage content="Hello world" />)
    expect(screen.getByText('Hello world')).toBeInTheDocument()
  })

  it('renders bold text as <strong>', () => {
    render(<MarkdownMessage content="**bold**" />)
    expect(screen.getByText('bold').tagName).toBe('STRONG')
  })

  it('renders inline code with rose styling', () => {
    render(<MarkdownMessage content="`inline`" />)
    const code = screen.getByText('inline')
    expect(code.tagName).toBe('CODE')
    expect(code.className).toContain('text-rose-600')
  })

  it('renders a code block in a dark pre', () => {
    render(<MarkdownMessage content={'```\nconsole.log("hi")\n```'} />)
    expect(screen.getByText('console.log("hi")')).toBeInTheDocument()
    const pre = document.querySelector('pre')
    expect(pre?.className).toContain('bg-gray-900')
  })

  it('renders an unordered list', () => {
    render(<MarkdownMessage content={'- apple\n- banana'} />)
    expect(screen.getByText('apple')).toBeInTheDocument()
    expect(screen.getByText('banana')).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd frontend && npm test -- MarkdownMessage
```

Expected: FAIL — `Cannot find module './MarkdownMessage'`

- [ ] **Step 4: Create the MarkdownMessage component**

Create `frontend/src/components/MarkdownMessage.tsx`:

```tsx
import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Components } from 'react-markdown'

const components: Components = {
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  h1: ({ children }) => <h1 className="text-base font-bold mb-1 mt-2">{children}</h1>,
  h2: ({ children }) => <h2 className="text-sm font-bold mb-1 mt-2">{children}</h2>,
  h3: ({ children }) => <h3 className="text-sm font-semibold mb-1 mt-2">{children}</h3>,
  ul: ({ children }) => <ul className="list-disc pl-4 mb-2">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-4 mb-2">{children}</ol>,
  li: ({ children }) => <li className="mb-0.5">{children}</li>,
  pre: ({ children }) => {
    const codeEl = React.Children.toArray(children)[0] as React.ReactElement<{ children: React.ReactNode }>
    return (
      <pre className="bg-gray-900 rounded-lg p-3 overflow-x-auto mb-2">
        <code className="text-gray-100 font-mono text-xs">{codeEl?.props?.children ?? children}</code>
      </pre>
    )
  },
  code: ({ children }) => (
    <code className="bg-gray-100 text-rose-600 px-1 rounded font-mono text-xs">{children}</code>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-gray-400 pl-3 italic text-gray-600 mb-2">{children}</blockquote>
  ),
  a: ({ children, href }) => (
    <a href={href} className="underline text-blue-600" target="_blank" rel="noreferrer">{children}</a>
  ),
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  table: ({ children }) => <table className="w-full text-xs border-collapse mb-2">{children}</table>,
  th: ({ children }) => <th className="border border-gray-300 px-2 py-1 font-semibold bg-gray-50">{children}</th>,
  td: ({ children }) => <td className="border border-gray-300 px-2 py-1">{children}</td>,
  hr: () => <hr className="border-gray-300 my-2" />,
}

interface Props { content: string }

export default function MarkdownMessage({ content }: Props) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {content}
    </ReactMarkdown>
  )
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd frontend && npm test -- MarkdownMessage
```

Expected: PASS — 5 tests pass

- [ ] **Step 6: Commit**

```bash
cd frontend
git add src/components/MarkdownMessage.tsx src/components/MarkdownMessage.test.tsx package.json package-lock.json
git commit -m "feat: add MarkdownMessage component for rendering LLM responses"
```

---

### Task 2: Wire MarkdownMessage into MessageList

**Files:**
- Modify: `frontend/src/components/MessageList.tsx`
- Create: `frontend/src/components/MessageList.test.tsx`

**Interfaces:**
- Consumes: `MarkdownMessage({ content: string }): JSX.Element` from `frontend/src/components/MarkdownMessage.tsx` (Task 1)

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/components/MessageList.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import MessageList from './MessageList'
import type { Message } from '../types'

function msg(role: 'user' | 'assistant', content: string): Message {
  return { role, content, createdAt: new Date().toISOString() }
}

describe('MessageList', () => {
  it('renders markdown for assistant messages', () => {
    render(<MessageList messages={[msg('assistant', '**bold**')]} />)
    expect(screen.getByText('bold').tagName).toBe('STRONG')
  })

  it('does not render markdown for user messages', () => {
    render(<MessageList messages={[msg('user', '**bold**')]} />)
    expect(screen.queryByText('bold')).toBeNull()
    expect(screen.getByText('**bold**')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd frontend && npm test -- MessageList
```

Expected: FAIL — both tests fail because `MessageList` renders all content as plain text

- [ ] **Step 3: Update MessageList to use MarkdownMessage for assistant messages**

Replace the full contents of `frontend/src/components/MessageList.tsx` with:

```tsx
import { useEffect, useRef } from 'react'
import type { Message } from '../types'
import MarkdownMessage from './MarkdownMessage'

interface Props { messages: Message[] }

export default function MessageList({ messages }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  return (
    <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
      {messages.map((m, i) => (
        <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
          <div
            className={`max-w-[80%] px-3.5 py-2.5 text-sm leading-relaxed break-words ${
              m.role === 'user'
                ? 'bg-[#0084ff] text-white rounded-[18px_18px_4px_18px] whitespace-pre-wrap'
                : 'bg-gray-200 text-gray-900 rounded-[18px_18px_18px_4px]'
            }`}
          >
            {m.role === 'user' ? m.content : <MarkdownMessage content={m.content} />}
          </div>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  )
}
```

Key changes from the original:
- Import `MarkdownMessage`
- User bubble keeps `whitespace-pre-wrap`; assistant bubble drops it (markdown handles whitespace)
- Assistant message content rendered via `<MarkdownMessage>` instead of `{m.content}`

- [ ] **Step 4: Run all frontend tests to verify they pass**

```bash
cd frontend && npm test
```

Expected: PASS — all tests pass (existing 4 + new 7 = 11 total)

- [ ] **Step 5: Commit**

```bash
cd frontend
git add src/components/MessageList.tsx src/components/MessageList.test.tsx
git commit -m "feat: render assistant messages as markdown in MessageList"
```
