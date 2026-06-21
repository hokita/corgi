# Markdown Message Display — Design Spec

**Date:** 2026-06-22  
**Status:** Approved

## Problem

LLM (Gemini) responses are currently rendered as plain text with `whitespace-pre-wrap`. Markdown syntax in responses (code blocks, lists, headers, etc.) appears as raw characters rather than formatted output.

## Goal

Render `assistant` messages as beautiful markdown inside the existing chat bubble. User messages remain unchanged.

## Scope

Frontend only. No backend, API, or type changes required.

## Architecture

A new `MarkdownMessage` component wraps `react-markdown` + `remark-gfm`. `MessageList.tsx` uses it for `role === 'assistant'` messages only.

```
MessageList
  └─ assistant message bubble
       └─ MarkdownMessage        ← new component
            └─ ReactMarkdown
                 └─ remark-gfm
```

## Dependencies

| Package | Purpose |
|---|---|
| `react-markdown` | Safe markdown → React elements renderer |
| `remark-gfm` | Adds GFM: tables, strikethrough, task lists, autolinks |

No sanitization library needed — `react-markdown` never uses `dangerouslySetInnerHTML`.

## Component: `MarkdownMessage`

File: `frontend/src/components/MarkdownMessage.tsx`

Props: `{ content: string }`

Renders `<ReactMarkdown remarkPlugins={[remarkGfm]} components={...}>` with the following element mappings:

| Element | Tailwind classes |
|---|---|
| `p` | `mb-2 last:mb-0` |
| `h1` | `text-base font-bold mb-1 mt-2` |
| `h2` | `text-sm font-bold mb-1 mt-2` |
| `h3` | `text-sm font-semibold mb-1 mt-2` |
| `ul` | `list-disc pl-4 mb-2` |
| `ol` | `list-decimal pl-4 mb-2` |
| `li` | `mb-0.5` |
| `code` (inline) | `bg-gray-100 text-rose-600 px-1 rounded font-mono text-xs` |
| `pre` | `bg-gray-900 rounded-lg p-3 overflow-x-auto mb-2` |
| `code` (inside `pre`) | `text-gray-100 font-mono text-xs` |
| `blockquote` | `border-l-2 border-gray-400 pl-3 italic text-gray-600 mb-2` |
| `a` | `underline text-blue-600` |
| `strong` | `font-semibold` |
| `em` | `italic` |
| `table` | `w-full text-xs border-collapse mb-2` |
| `th` | `border border-gray-300 px-2 py-1 font-semibold bg-gray-50` |
| `td` | `border border-gray-300 px-2 py-1` |
| `hr` | `border-gray-300 my-2` |

## Changes to `MessageList.tsx`

- Import `MarkdownMessage`
- Replace `{m.content}` with `<MarkdownMessage content={m.content} />` for `role === 'assistant'` messages only
- Remove `whitespace-pre-wrap` from the assistant bubble class (markdown handles whitespace)

## Out of Scope

- Syntax highlighting (no library added; dark code block color via Tailwind only)
- Streaming responses
- User message markdown rendering
