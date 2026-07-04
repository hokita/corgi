# Langfuse Tracing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Langfuse (Cloud free tier) tracing to the corgi backend so every chat request, tool execution, and title generation is visible end-to-end with token usage.

**Architecture:** The route layer opens one root observation ("trace") per chat request via `startActiveObservation`; `GeminiProvider` and `GeminiTitleGenerator` create generation/tool observations that nest under it through OpenTelemetry async-local-storage context. A config module registers the Langfuse span processor at startup and is a silent no-op when Langfuse keys are unset. Spans flush before each SSE response ends (Cloud Run throttles CPU after responses).

**Tech Stack:** Langfuse JS SDK (OTel-based: `@langfuse/tracing`, `@langfuse/otel`), `@opentelemetry/sdk-node`, existing stack (Node 24, Express, TypeScript strict, Vitest 1.6, `@google/generative-ai` 0.24).

**Spec:** `docs/superpowers/specs/2026-07-04-langfuse-tracing-design.md`

## Global Constraints

- **No-op without keys:** if `LANGFUSE_PUBLIC_KEY` or `LANGFUSE_SECRET_KEY` is unset, no tracer provider is registered and all tracing calls are silent no-ops. Zero new required config for local dev or CI.
- **Tracing must never break chat:** flush errors are caught and logged; span export is asynchronous.
- **No `AIProvider` interface changes.**
- Exact observation names: root trace `chat`; generations `gemini-chat`, `gemini-chat-followup`, `gemini-title`; title trace `generate-title`; tool spans `tool:<function name>` (e.g. `tool:get_hacker_news_briefing`).
- Exact env vars: `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL`, `LANGFUSE_TRACING_ENVIRONMENT`.
- Usage mapping (Gemini `usageMetadata` → Langfuse `usageDetails`): `promptTokenCount`→`input`, `candidatesTokenCount`→`output`, `thoughtsTokenCount`→`reasoning`, `totalTokenCount`→`total`.
- Red/green TDD (user's global instruction): write the failing test first, run it, implement, run again.
- All commands run from `backend/` unless stated otherwise.

### Known API-name risks (check once, then move on)

The Langfuse SDK docs moved from v4 to v5 with the same OTel architecture. Three names may differ by installed version. If a compile error or failed assertion hits one of these, apply the listed fallback — do not improvise beyond it:

1. **`span.updateTrace({...})`** (used in Task 4): if it doesn't exist, use `import { updateActiveTrace } from '@langfuse/tracing'` and call `updateActiveTrace({...})` inside the active callback instead.
2. **Langfuse span attribute keys** in test assertions (`langfuse.observation.type`, `langfuse.observation.model.name`, `langfuse.observation.input`, `langfuse.observation.output`, `langfuse.observation.usage_details`, `langfuse.observation.level`, `langfuse.observation.status_message`, `langfuse.trace.input`, `langfuse.trace.output`, `langfuse.trace.metadata.conversationId`): if an assertion finds `undefined`, add `console.log(span.attributes)` to the test once, read the actual key names from the output, update the assertion strings, and remove the log.
3. **`ReadableSpan.parentSpanContext`** (OTel JS 2.x) — on OTel 1.x it's `parentSpanId: string` instead of `parentSpanContext.spanId`.

---

### Task 1: Langfuse config module

**Files:**
- Modify: `backend/package.json` (via npm install)
- Create: `backend/src/config/langfuse.ts`
- Test: `backend/src/config/langfuse.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces (used by Tasks 2–5):
  - `initLangfuse(): void` — registers the Langfuse span processor iff both keys are set.
  - `flushLangfuse(): Promise<void>` — force-flushes pending spans; resolves immediately when uninitialized.
  - `shutdownLangfuse(): Promise<void>` — flushes and shuts down the SDK; resolves immediately when uninitialized.
  - `interface GeminiUsageMetadata { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; totalTokenCount?: number }`
  - `toUsageDetails(usage?: GeminiUsageMetadata): Record<string, number> | undefined`

- [ ] **Step 1: Install dependencies**

```bash
npm install @langfuse/tracing @langfuse/otel @opentelemetry/sdk-node
npm install -D @opentelemetry/sdk-trace-node @opentelemetry/api
```

Expected: installs succeed; `package.json` gains the three dependencies and two devDependencies. (`@opentelemetry/sdk-trace-node` provides `NodeTracerProvider`/`InMemorySpanExporter` for tests; `@opentelemetry/api` is imported directly in tests.)

- [ ] **Step 2: Write the failing test**

Create `backend/src/config/langfuse.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { trace } from '@opentelemetry/api'
import { initLangfuse, flushLangfuse, shutdownLangfuse, toUsageDetails } from './langfuse'

describe('toUsageDetails', () => {
  it('maps Gemini usage fields to Langfuse usage details', () => {
    expect(
      toUsageDetails({
        promptTokenCount: 10,
        candidatesTokenCount: 20,
        thoughtsTokenCount: 5,
        totalTokenCount: 35,
      })
    ).toEqual({ input: 10, output: 20, reasoning: 5, total: 35 })
  })

  it('omits absent fields', () => {
    expect(toUsageDetails({ promptTokenCount: 3, totalTokenCount: 3 })).toEqual({
      input: 3,
      total: 3,
    })
  })

  it('returns undefined when usage is missing', () => {
    expect(toUsageDetails(undefined)).toBeUndefined()
  })

  it('returns undefined when usage has no counts', () => {
    expect(toUsageDetails({})).toBeUndefined()
  })
})

describe('when Langfuse keys are not configured', () => {
  it('initLangfuse does not register a recording tracer', () => {
    delete process.env.LANGFUSE_PUBLIC_KEY
    delete process.env.LANGFUSE_SECRET_KEY
    initLangfuse()
    const span = trace.getTracer('test').startSpan('probe')
    expect(span.isRecording()).toBe(false)
    span.end()
  })

  it('flushLangfuse resolves', async () => {
    await expect(flushLangfuse()).resolves.toBeUndefined()
  })

  it('shutdownLangfuse resolves', async () => {
    await expect(shutdownLangfuse()).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/config/langfuse.test.ts`
Expected: FAIL — cannot resolve `./langfuse`.

- [ ] **Step 4: Write the implementation**

Create `backend/src/config/langfuse.ts`:

```ts
import { NodeSDK } from '@opentelemetry/sdk-node'
import { LangfuseSpanProcessor } from '@langfuse/otel'

let sdk: NodeSDK | undefined
let spanProcessor: LangfuseSpanProcessor | undefined

// Reads LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY / LANGFUSE_BASE_URL /
// LANGFUSE_TRACING_ENVIRONMENT from the environment. Without keys nothing is
// registered, so every tracing call in the app is a silent no-op.
export function initLangfuse(): void {
  if (!process.env.LANGFUSE_PUBLIC_KEY || !process.env.LANGFUSE_SECRET_KEY) return
  spanProcessor = new LangfuseSpanProcessor()
  sdk = new NodeSDK({ spanProcessors: [spanProcessor] })
  sdk.start()
}

// Cloud Run throttles CPU once a response ends, so pending spans must be
// flushed while the request is still open.
export async function flushLangfuse(): Promise<void> {
  await spanProcessor?.forceFlush()
}

export async function shutdownLangfuse(): Promise<void> {
  await sdk?.shutdown()
}

// Subset of Gemini's UsageMetadata; thoughtsTokenCount exists at runtime on
// thinking models but is missing from the legacy SDK's type.
export interface GeminiUsageMetadata {
  promptTokenCount?: number
  candidatesTokenCount?: number
  thoughtsTokenCount?: number
  totalTokenCount?: number
}

export function toUsageDetails(
  usage?: GeminiUsageMetadata
): Record<string, number> | undefined {
  if (!usage) return undefined
  const details: Record<string, number> = {}
  if (usage.promptTokenCount !== undefined) details.input = usage.promptTokenCount
  if (usage.candidatesTokenCount !== undefined) details.output = usage.candidatesTokenCount
  if (usage.thoughtsTokenCount !== undefined) details.reasoning = usage.thoughtsTokenCount
  if (usage.totalTokenCount !== undefined) details.total = usage.totalTokenCount
  return Object.keys(details).length > 0 ? details : undefined
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/config/langfuse.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Run the full backend suite, lint, and typecheck**

Run: `npm test && npm run lint && npm run build`
Expected: all pass, no regressions.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/config/langfuse.ts src/config/langfuse.test.ts
git commit -m "feat: add Langfuse config module with no-op fallback"
```

---

### Task 2: GeminiProvider tracing (generations, tool spans, errors)

**Files:**
- Modify: `backend/src/providers/GeminiProvider.ts`
- Test (create): `backend/src/providers/GeminiProvider.tracing.test.ts`

**Interfaces:**
- Consumes: `toUsageDetails`, `GeminiUsageMetadata` from `../config/langfuse` (Task 1); `startObservation` from `@langfuse/tracing`.
- Produces: spans named `gemini-chat`, `gemini-chat-followup`, `tool:<name>` that nest under whatever observation is active when `chatStream` is iterated (Task 4 relies on this). No signature changes.

- [ ] **Step 1: Write the failing tests**

Create `backend/src/providers/GeminiProvider.tracing.test.ts`. It registers a real in-memory OTel tracer (so Langfuse observations are recorded and inspectable) and mocks the Gemini SDK exactly like the existing `GeminiProvider.test.ts`:

```ts
import { beforeEach, describe, it, expect, vi } from 'vitest'
import {
  NodeTracerProvider,
  SimpleSpanProcessor,
  InMemorySpanExporter,
} from '@opentelemetry/sdk-trace-node'
import { startActiveObservation } from '@langfuse/tracing'
import type { StreamItem, FunctionExecutor } from './AIProvider'

const exporter = new InMemorySpanExporter()
const tracerProvider = new NodeTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
})
tracerProvider.register()

const mockSendMessageStream = vi.fn()
const mockGenerateContentStream = vi.fn()
const mockStartChat = vi.fn(() => ({ sendMessageStream: mockSendMessageStream }))
const mockGetGenerativeModel = vi.fn(() => ({
  startChat: mockStartChat,
  generateContentStream: mockGenerateContentStream,
}))

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
    getGenerativeModel: mockGetGenerativeModel,
  })),
  SchemaType: {
    OBJECT: 'object',
    ARRAY: 'array',
    STRING: 'string',
  },
}))

import { GeminiProvider } from './GeminiProvider'

const noopExecutor: FunctionExecutor = vi.fn().mockResolvedValue({})

async function collectStream(stream: AsyncIterable<StreamItem>): Promise<StreamItem[]> {
  const items: StreamItem[] = []
  for await (const item of stream) items.push(item)
  return items
}

function textChunk(text: string) {
  return { candidates: [{ content: { parts: [{ text }] } }] }
}

function finishedSpan(name: string) {
  return exporter.getFinishedSpans().find((s) => s.name === name)
}

beforeEach(() => {
  vi.clearAllMocks()
  exporter.reset()
})

describe('GeminiProvider tracing: primary generation', () => {
  it('records a generation span with model, output, and usage', async () => {
    async function* fakeStream() {
      yield textChunk('Hello')
      yield {
        candidates: [{ content: { parts: [{ text: ' world' }] } }],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 7, totalTokenCount: 12 },
      }
    }
    mockSendMessageStream.mockResolvedValue({ stream: fakeStream() })
    const provider = new GeminiProvider('fake-key')
    await collectStream(provider.chatStream([], 'Hi', noopExecutor))

    const gen = finishedSpan('gemini-chat')
    expect(gen).toBeDefined()
    expect(gen!.attributes['langfuse.observation.type']).toBe('generation')
    expect(gen!.attributes['langfuse.observation.model.name']).toBe('gemini-3.5-flash')
    expect(JSON.parse(String(gen!.attributes['langfuse.observation.output']))).toBe('Hello world')
    expect(JSON.parse(String(gen!.attributes['langfuse.observation.usage_details']))).toEqual({
      input: 5,
      output: 7,
      total: 12,
    })
  })

  it('marks the generation span as ERROR when the stream is blocked', async () => {
    async function* fakeStream() {
      yield textChunk('The story begins')
      yield { candidates: [{ finishReason: 'RECITATION', content: { parts: [] } }] }
    }
    mockSendMessageStream.mockResolvedValue({ stream: fakeStream() })
    const provider = new GeminiProvider('fake-key')
    await expect(collectStream(provider.chatStream([], 'Hi', noopExecutor))).rejects.toThrow()

    const gen = finishedSpan('gemini-chat')
    expect(gen).toBeDefined()
    expect(gen!.attributes['langfuse.observation.level']).toBe('ERROR')
    expect(String(gen!.attributes['langfuse.observation.status_message'])).toContain('RECITATION')
  })
})

describe('GeminiProvider tracing: tool calls and follow-up', () => {
  function toolCallThenFollowUp() {
    async function* firstStream() {
      yield {
        candidates: [
          {
            content: {
              parts: [{ functionCall: { name: 'get_hacker_news_briefing', args: {} } }],
            },
          },
        ],
      }
    }
    async function* followUpStream() {
      yield {
        candidates: [{ content: { parts: [{ text: 'Briefing text' }] } }],
        usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 30, totalTokenCount: 80 },
      }
    }
    mockSendMessageStream.mockResolvedValueOnce({ stream: firstStream() })
    mockGenerateContentStream.mockResolvedValueOnce({ stream: followUpStream() })
  }

  it('records a tool span with input args and output', async () => {
    toolCallThenFollowUp()
    const executeFn: FunctionExecutor = vi.fn().mockResolvedValue({ stories: [] })
    const provider = new GeminiProvider('fake-key')
    await collectStream(provider.chatStream([], 'Morning briefing', executeFn))

    const tool = finishedSpan('tool:get_hacker_news_briefing')
    expect(tool).toBeDefined()
    expect(JSON.parse(String(tool!.attributes['langfuse.observation.input']))).toEqual({})
    expect(JSON.parse(String(tool!.attributes['langfuse.observation.output']))).toEqual({
      stories: [],
    })
  })

  it('records a follow-up generation span with its own usage', async () => {
    toolCallThenFollowUp()
    const executeFn: FunctionExecutor = vi.fn().mockResolvedValue({ stories: [] })
    const provider = new GeminiProvider('fake-key')
    await collectStream(provider.chatStream([], 'Morning briefing', executeFn))

    const followUp = finishedSpan('gemini-chat-followup')
    expect(followUp).toBeDefined()
    expect(followUp!.attributes['langfuse.observation.type']).toBe('generation')
    expect(JSON.parse(String(followUp!.attributes['langfuse.observation.output']))).toBe(
      'Briefing text'
    )
    expect(JSON.parse(String(followUp!.attributes['langfuse.observation.usage_details']))).toEqual(
      { input: 50, output: 30, total: 80 }
    )
  })

  it('nests provider spans under an active parent observation', async () => {
    toolCallThenFollowUp()
    const executeFn: FunctionExecutor = vi.fn().mockResolvedValue({ stories: [] })
    const provider = new GeminiProvider('fake-key')
    await startActiveObservation('chat', async () => {
      await collectStream(provider.chatStream([], 'Morning briefing', executeFn))
    })

    const root = finishedSpan('chat')!
    for (const name of ['gemini-chat', 'tool:get_hacker_news_briefing', 'gemini-chat-followup']) {
      const child = finishedSpan(name)!
      expect(child.spanContext().traceId).toBe(root.spanContext().traceId)
      // OTel 1.x: use child.parentSpanId instead
      expect(child.parentSpanContext?.spanId).toBe(root.spanContext().spanId)
    }
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/providers/GeminiProvider.tracing.test.ts`
Expected: FAIL — no spans named `gemini-chat` etc. are recorded (finds are `undefined`).

- [ ] **Step 3: Implement the instrumentation**

Modify `backend/src/providers/GeminiProvider.ts`. Complete updated file:

```ts
import { GoogleGenerativeAI } from '@google/generative-ai'
import type {
  Content,
  EnhancedGenerateContentResponse,
  Part,
  Tool,
  ToolConfig,
} from '@google/generative-ai'
import { startObservation } from '@langfuse/tracing'
import type { AIProvider, Message, StreamItem, FunctionExecutor } from './AIProvider'
import { GEMINI_CHAT_MODEL } from '../config/gemini'
import { toUsageDetails } from '../config/langfuse'
import type { GeminiUsageMetadata } from '../config/langfuse'
import { CHAT_SYSTEM_PROMPT } from '../prompts/chat'
import { chatFunctionDeclarations } from '../tools/registry'

export interface GeminiProviderOptions {
  googleSearch?: boolean
}

function currentJstDatetime(): string {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' }).replace('T', ' ') + ' JST'
}

function toGeminiHistory(history: Message[]): Content[] {
  return history.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }))
}

function parseSuggestOptionsItems(args: unknown): string[] | undefined {
  const items = (args as { items?: string[] } | undefined)?.items
  return Array.isArray(items) && items.length > 0 ? items : undefined
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// The SDK's ToolConfig doesn't model this field; it is required when mixing
// built-in tools (googleSearch) with function calling.
const SERVER_SIDE_TOOL_CONFIG = { includeServerSideToolInvocations: true } as unknown as ToolConfig

interface StreamState {
  suggestions?: string[]
  hasText: boolean
  usageMetadata?: GeminiUsageMetadata
}

// Thinking models stream thought-summary parts: regular text parts flagged
// thought: true. The legacy SDK predates them (chunk.text() would concatenate
// them into the answer), so text is extracted here with thoughts skipped.
function visibleText(chunk: EnhancedGenerateContentResponse): string {
  return (chunk.candidates?.[0]?.content?.parts ?? [])
    .filter((p) => typeof p.text === 'string' && !(p as { thought?: boolean }).thought)
    .map((p) => p.text)
    .join('')
}

// chunk.text() used to throw on these; visibleText() doesn't, so blocked
// responses must be surfaced here or they end the stream silently and a
// truncated message gets persisted as if it succeeded.
const BAD_FINISH_REASONS = ['SAFETY', 'RECITATION', 'LANGUAGE']

function assertChunkNotBlocked(chunk: EnhancedGenerateContentResponse): void {
  const finishReason = chunk.candidates?.[0]?.finishReason
  if (finishReason && BAD_FINISH_REASONS.includes(finishReason)) {
    throw new Error(`Gemini response was blocked: finishReason ${finishReason}`)
  }
  if (chunk.promptFeedback?.blockReason) {
    throw new Error(`Gemini request was blocked: ${chunk.promptFeedback.blockReason}`)
  }
}

export class GeminiProvider implements AIProvider {
  private client: GoogleGenerativeAI
  private googleSearch: boolean

  constructor(apiKey: string, options: GeminiProviderOptions = {}) {
    this.googleSearch = options.googleSearch ?? false
    this.client = new GoogleGenerativeAI(apiKey)
  }

  // Shared chunk loop for the primary and follow-up streams. The two passes
  // differ only via hooks: the primary pass captures raw parts (rawParts) and
  // executes non-suggest function calls (onFunctionCall); the follow-up pass
  // passes no hooks, so such calls are ignored and its text still streams.
  private async *emitTextFromStream(
    stream: AsyncIterable<EnhancedGenerateContentResponse>,
    state: StreamState,
    hooks: {
      rawParts?: Part[]
      onFunctionCall?: (name: string, args: unknown) => Promise<void>
      onSuggestOptionsCall?: () => void
    } = {}
  ): AsyncIterable<string> {
    for await (const chunk of stream) {
      assertChunkNotBlocked(chunk)
      // Streaming responses carry usageMetadata on the final chunk.
      if (chunk.usageMetadata) state.usageMetadata = chunk.usageMetadata
      if (hooks.rawParts) {
        for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
          hooks.rawParts.push(part)
        }
      }
      let hasFunctionCall = false
      for (const candidate of chunk.candidates ?? []) {
        for (const part of candidate.content?.parts ?? []) {
          if (!('functionCall' in part) || !part.functionCall) continue
          const { name, args } = part.functionCall
          if (name === 'suggest_options') {
            hasFunctionCall = true
            const items = parseSuggestOptionsItems(args)
            if (items) state.suggestions = items
            hooks.onSuggestOptionsCall?.()
          } else if (hooks.onFunctionCall) {
            hasFunctionCall = true
            await hooks.onFunctionCall(name, args)
          }
        }
      }
      if (!hasFunctionCall) {
        const text = visibleText(chunk)
        if (text) {
          state.hasText = true
          yield text
        }
      }
    }
  }

  async *chatStream(
    history: Message[],
    newMessage: string,
    executeFn: FunctionExecutor
  ): AsyncIterable<StreamItem> {
    const model = this.client.getGenerativeModel({
      model: GEMINI_CHAT_MODEL,
      systemInstruction:
        `The current date and time is ${currentJstDatetime()}. ` + CHAT_SYSTEM_PROMPT,
    })
    const tools: Tool[] = [{ functionDeclarations: chatFunctionDeclarations }]
    // The SDK's Tool union doesn't include googleSearch
    if (this.googleSearch) tools.push({ googleSearch: {} } as unknown as Tool)
    const chat = model.startChat({
      history: toGeminiHistory(history),
      tools,
      // Required when mixing built-in tools (googleSearch) with function calling
      ...(this.googleSearch && { toolConfig: SERVER_SIDE_TOOL_CONFIG }),
    })

    const state: StreamState = { hasText: false }
    const pendingFunctionResponses: Array<{ name: string; response: unknown }> = []
    let executedToolCall = false
    // Capture raw parts from the stream. The SDK's ChatSession strips
    // thought_signature when merging chunks into its internal history, so we
    // preserve the raw parts ourselves for use in the follow-up call.
    const rawModelParts: Part[] = []

    const generation = startObservation(
      'gemini-chat',
      {
        model: GEMINI_CHAT_MODEL,
        input: [...toGeminiHistory(history), { role: 'user', parts: [{ text: newMessage }] }],
      },
      { asType: 'generation' }
    )
    let primaryText = ''
    try {
      const result = await chat.sendMessageStream(newMessage)
      for await (const text of this.emitTextFromStream(result.stream, state, {
        rawParts: rawModelParts,
        onFunctionCall: async (name, args) => {
          executedToolCall = true
          const toolSpan = startObservation(`tool:${name}`, { input: args }, { asType: 'tool' })
          let response: unknown
          try {
            response = await executeFn(name, args)
          } catch (err) {
            toolSpan.update({ level: 'ERROR', statusMessage: errorMessage(err) }).end()
            throw err
          }
          toolSpan.update({ output: response }).end()
          pendingFunctionResponses.push({ name, response })
        },
        // The model turn is replayed verbatim in the follow-up call, and the API
        // requires a functionResponse for every functionCall in it — including
        // suggest_options, even though it is handled client-side.
        onSuggestOptionsCall: () => {
          pendingFunctionResponses.push({
            name: 'suggest_options',
            response: { result: 'displayed' },
          })
        },
      })) {
        primaryText += text
        yield text
      }
    } catch (err) {
      generation.update({ level: 'ERROR', statusMessage: errorMessage(err) }).end()
      throw err
    }
    generation
      .update({ output: primaryText, usageDetails: toUsageDetails(state.usageMetadata) })
      .end()

    // If Gemini only called functions and generated no text, send function results
    // back so Gemini produces its text response. Use model.generateContentStream
    // with manually-built history (not chat.sendMessageStream) so the raw model
    // parts — including thought_signature — are preserved in the request.
    if (executedToolCall && !state.hasText) {
      const manualHistory: Content[] = [
        ...toGeminiHistory(history),
        { role: 'user', parts: [{ text: newMessage }] },
        { role: 'model', parts: rawModelParts },
        // Only functionResponse parts here: mixing in a text part disrupts the
        // thinking model's turn continuation and makes it write its reasoning
        // as visible reply text.
        {
          role: 'user',
          parts: pendingFunctionResponses.map((r) => ({
            functionResponse: { name: r.name, response: r.response as object },
          })),
        },
      ]
      // Usage on the state is per-pass; reset so the follow-up generation
      // reports its own numbers rather than the primary pass's.
      state.usageMetadata = undefined
      const followUpGeneration = startObservation(
        'gemini-chat-followup',
        { model: GEMINI_CHAT_MODEL, input: manualHistory },
        { asType: 'generation' }
      )
      let followUpText = ''
      try {
        const followUp = await model.generateContentStream({
          contents: manualHistory,
          tools,
          toolConfig: SERVER_SIDE_TOOL_CONFIG,
        })
        for await (const text of this.emitTextFromStream(followUp.stream, state)) {
          followUpText += text
          yield text
        }
      } catch (err) {
        followUpGeneration.update({ level: 'ERROR', statusMessage: errorMessage(err) }).end()
        throw err
      }
      followUpGeneration
        .update({ output: followUpText, usageDetails: toUsageDetails(state.usageMetadata) })
        .end()
    }

    if (state.suggestions) {
      yield { type: 'suggestions', items: state.suggestions }
    }
  }
}
```

Notes:
- `chunk.usageMetadata` is typed `UsageMetadata` in the legacy SDK; it assigns to `GeminiUsageMetadata` structurally (`thoughtsTokenCount` is untyped there but present at runtime and read through our interface).
- Tool spans are created via bare `startObservation`, so they parent to the active context (the route's root `chat` span in production) as siblings of the generations.

- [ ] **Step 4: Run the tracing tests to verify they pass**

Run: `npx vitest run src/providers/GeminiProvider.tracing.test.ts`
Expected: PASS (5 tests). If an attribute-key assertion fails, apply Known API-name risk #2; if `parentSpanContext` is undefined everywhere, apply risk #3.

- [ ] **Step 5: Run the full suite**

Run: `npm test && npm run lint && npm run build`
Expected: all pass — the existing `GeminiProvider.test.ts` must pass unchanged. That file registers no tracer provider, so `@langfuse/tracing` falls back to OTel's no-op tracer and the new instrumentation is inert there.

- [ ] **Step 6: Commit**

```bash
git add src/providers/GeminiProvider.ts src/providers/GeminiProvider.tracing.test.ts
git commit -m "feat: trace Gemini chat generations and tool calls with Langfuse"
```

---

### Task 3: GeminiTitleGenerator tracing

**Files:**
- Modify: `backend/src/providers/GeminiTitleGenerator.ts`
- Test (create): `backend/src/providers/GeminiTitleGenerator.tracing.test.ts`

**Interfaces:**
- Consumes: `toUsageDetails` from `../config/langfuse` (Task 1); `startObservation` from `@langfuse/tracing`.
- Produces: standalone trace `generate-title` containing generation `gemini-title`. No signature changes.

- [ ] **Step 1: Write the failing tests**

Create `backend/src/providers/GeminiTitleGenerator.tracing.test.ts`:

```ts
import { beforeEach, describe, it, expect, vi } from 'vitest'
import {
  NodeTracerProvider,
  SimpleSpanProcessor,
  InMemorySpanExporter,
} from '@opentelemetry/sdk-trace-node'

const exporter = new InMemorySpanExporter()
const tracerProvider = new NodeTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
})
tracerProvider.register()

const mockGenerateContent = vi.fn()
const mockGetGenerativeModel = vi.fn(() => ({
  generateContent: mockGenerateContent,
}))

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
    getGenerativeModel: mockGetGenerativeModel,
  })),
}))

import { GeminiTitleGenerator } from './GeminiTitleGenerator'

function finishedSpan(name: string) {
  return exporter.getFinishedSpans().find((s) => s.name === name)
}

beforeEach(() => {
  vi.clearAllMocks()
  exporter.reset()
})

describe('GeminiTitleGenerator tracing', () => {
  it('records a trace span and a nested generation with usage', async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () => 'Learning Japanese Basics',
        usageMetadata: { promptTokenCount: 40, candidatesTokenCount: 6, totalTokenCount: 46 },
      },
    })
    const gen = new GeminiTitleGenerator('fake-key')
    await gen.generateTitle('I want to start learning Japanese')

    const root = finishedSpan('generate-title')
    expect(root).toBeDefined()
    expect(JSON.parse(String(root!.attributes['langfuse.observation.input']))).toBe(
      'I want to start learning Japanese'
    )
    expect(JSON.parse(String(root!.attributes['langfuse.observation.output']))).toBe(
      'Learning Japanese Basics'
    )

    const generation = finishedSpan('gemini-title')
    expect(generation).toBeDefined()
    expect(generation!.attributes['langfuse.observation.type']).toBe('generation')
    expect(generation!.attributes['langfuse.observation.model.name']).toBe('gemini-2.5-flash-lite')
    expect(
      JSON.parse(String(generation!.attributes['langfuse.observation.usage_details']))
    ).toEqual({ input: 40, output: 6, total: 46 })
    // OTel 1.x: use generation.parentSpanId instead
    expect(generation!.parentSpanContext?.spanId).toBe(root!.spanContext().spanId)
  })

  it('marks spans as ERROR and records the fallback title on failure', async () => {
    mockGenerateContent.mockRejectedValue(new Error('API error'))
    const gen = new GeminiTitleGenerator('fake-key')
    const title = await gen.generateTitle('A'.repeat(60))
    expect(title).toBe('A'.repeat(40))

    const generation = finishedSpan('gemini-title')
    expect(generation).toBeDefined()
    expect(generation!.attributes['langfuse.observation.level']).toBe('ERROR')

    const root = finishedSpan('generate-title')
    expect(root).toBeDefined()
    expect(root!.attributes['langfuse.observation.level']).toBe('ERROR')
    expect(JSON.parse(String(root!.attributes['langfuse.observation.output']))).toBe(
      'A'.repeat(40)
    )
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/providers/GeminiTitleGenerator.tracing.test.ts`
Expected: FAIL — spans not found.

- [ ] **Step 3: Implement the instrumentation**

Replace `backend/src/providers/GeminiTitleGenerator.ts` with:

```ts
import { GoogleGenerativeAI } from '@google/generative-ai'
import { startObservation } from '@langfuse/tracing'
import type { TitleGenerator } from './AIProvider'
import { GEMINI_TITLE_MODEL } from '../config/gemini'
import { toUsageDetails } from '../config/langfuse'

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export class GeminiTitleGenerator implements TitleGenerator {
  private client: GoogleGenerativeAI

  constructor(apiKey: string) {
    this.client = new GoogleGenerativeAI(apiKey)
  }

  async generateTitle(message: string): Promise<string> {
    const trace = startObservation('generate-title', { input: message })
    try {
      const model = this.client.getGenerativeModel({ model: GEMINI_TITLE_MODEL })
      const prompt =
        `Generate a short title (max 50 characters, no quotes, no punctuation at end) ` +
        `for a conversation that starts with this message: "${message}"\n` +
        `Return only the title, nothing else.`
      const generation = trace.startObservation(
        'gemini-title',
        { model: GEMINI_TITLE_MODEL, input: prompt },
        { asType: 'generation' }
      )
      let result
      try {
        result = await model.generateContent(prompt)
      } catch (err) {
        generation.update({ level: 'ERROR', statusMessage: errorMessage(err) }).end()
        throw err
      }
      const title = result.response.text().trim().slice(0, 50) || message.slice(0, 40)
      generation
        .update({ output: title, usageDetails: toUsageDetails(result.response.usageMetadata) })
        .end()
      trace.update({ output: title }).end()
      return title
    } catch (err) {
      console.error('[GeminiTitleGenerator] failed to generate title:', err)
      const fallback = message.slice(0, 40)
      trace
        .update({ output: fallback, level: 'ERROR', statusMessage: errorMessage(err) })
        .end()
      return fallback
    }
  }
}
```

Behavior note: the original computed `title.slice(0, 50)` after `trim()`; this preserves that (`.trim().slice(0, 50)`), and the error fallback (`message.slice(0, 40)`) is unchanged.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/providers/GeminiTitleGenerator.tracing.test.ts src/providers/GeminiTitleGenerator.test.ts`
Expected: PASS — both the new tracing tests and the existing tests.

- [ ] **Step 5: Run the full suite**

Run: `npm test && npm run lint && npm run build`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/providers/GeminiTitleGenerator.ts src/providers/GeminiTitleGenerator.tracing.test.ts
git commit -m "feat: trace title generation with Langfuse"
```

---

### Task 4: Route-level root trace and per-request flush

**Files:**
- Modify: `backend/src/routes/conversations.ts`
- Test (create): `backend/src/routes/conversations.tracing.test.ts`

**Interfaces:**
- Consumes: `flushLangfuse` from `../config/langfuse` (Task 1); `startActiveObservation` from `@langfuse/tracing`. Provider spans from Tasks 2–3 nest under the root span created here via OTel context.
- Produces: root span `chat` per chat request with trace-level input/output/metadata; a flush after every conversations request.

- [ ] **Step 1: Write the failing tests**

Create `backend/src/routes/conversations.tracing.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import type { Request, Response, NextFunction } from 'express'
import {
  NodeTracerProvider,
  SimpleSpanProcessor,
  InMemorySpanExporter,
} from '@opentelemetry/sdk-trace-node'
import type { AIProvider, TitleGenerator, FunctionExecutor } from '../providers/AIProvider'

const exporter = new InMemorySpanExporter()
const tracerProvider = new NodeTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
})
tracerProvider.register()

vi.mock('../services/firestore', () => ({
  createConversation: vi.fn().mockResolvedValue('conv123'),
  getConversation: vi.fn().mockResolvedValue({
    id: 'conv123',
    uid: 'u1',
    title: 'Hello world',
    lastMessage: '',
    createdAt: null,
    updatedAt: null,
  }),
  listConversations: vi.fn().mockResolvedValue([]),
  addMessage: vi.fn().mockResolvedValue(undefined),
  getMessages: vi.fn().mockResolvedValue([]),
  updateConversationLastMessage: vi.fn().mockResolvedValue(undefined),
  deleteConversation: vi.fn().mockResolvedValue(undefined),
  saveEnglishMistake: vi.fn().mockResolvedValue(undefined),
  listEnglishMistakes: vi.fn().mockResolvedValue([]),
}))

vi.mock('../services/hnCache', () => ({
  getHNStories: vi.fn().mockResolvedValue([]),
}))

const mockFlush = vi.fn().mockResolvedValue(undefined)
vi.mock('../config/langfuse', () => ({
  flushLangfuse: () => mockFlush(),
}))

import { createConversationsRouter } from './conversations'

async function* defaultStream() {
  yield 'AI reply'
}

const mockAI: AIProvider = {
  chatStream: vi.fn().mockImplementation((_h: unknown, _m: unknown, _e: FunctionExecutor) => {
    return defaultStream()
  }),
}

const mockTitleGen: TitleGenerator = {
  generateTitle: vi.fn().mockResolvedValue('Mock Title'),
}

function mockAuth(req: Request, _: Response, next: NextFunction) {
  req.uid = 'u1'
  next()
}

const app = express()
app.use(express.json())
app.use('/api/conversations', mockAuth, createConversationsRouter(mockAI, mockTitleGen))

function finishedSpan(name: string) {
  return exporter.getFinishedSpans().find((s) => s.name === name)
}

beforeEach(() => {
  vi.clearAllMocks()
  exporter.reset()
  vi.mocked(mockAI.chatStream).mockImplementation(
    (_h: unknown, _m: unknown, _e: FunctionExecutor) => defaultStream()
  )
})

describe('conversations route tracing', () => {
  it('wraps the chat stream in a root span with trace input and output', async () => {
    const res = await request(app)
      .post('/api/conversations/conv123/messages')
      .send({ message: 'Hi' })
      .buffer(true)
    expect(res.status).toBe(200)

    const root = finishedSpan('chat')
    expect(root).toBeDefined()
    expect(JSON.parse(String(root!.attributes['langfuse.trace.input']))).toBe('Hi')
    expect(JSON.parse(String(root!.attributes['langfuse.trace.output']))).toBe('AI reply')
    expect(root!.attributes['langfuse.trace.metadata.conversationId']).toBe('conv123')
  })

  it('flushes Langfuse after a chat request', async () => {
    await request(app)
      .post('/api/conversations/conv123/messages')
      .send({ message: 'Hi' })
      .buffer(true)
    expect(mockFlush).toHaveBeenCalled()
  })

  it('marks the root span as ERROR when the stream fails, and still flushes', async () => {
    vi.mocked(mockAI.chatStream).mockImplementation(() => {
      // eslint-disable-next-line require-yield
      return (async function* (): AsyncGenerator<string> {
        throw new Error('stream exploded')
      })()
    })
    const res = await request(app)
      .post('/api/conversations/conv123/messages')
      .send({ message: 'Hi' })
      .buffer(true)
    expect(res.text).toContain('error')

    const root = finishedSpan('chat')
    expect(root).toBeDefined()
    expect(root!.attributes['langfuse.observation.level']).toBe('ERROR')
    expect(mockFlush).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/routes/conversations.tracing.test.ts`
Expected: FAIL — no `chat` span, `mockFlush` never called.

- [ ] **Step 3: Implement the route instrumentation**

In `backend/src/routes/conversations.ts`, add imports at the top:

```ts
import { startActiveObservation } from '@langfuse/tracing'
import { flushLangfuse } from '../config/langfuse'
```

Replace the `streamAndPersist` function with:

```ts
async function streamAndPersist(opts: {
  res: Response
  ai: AIProvider
  uid: string
  conversationId: string
  history: Message[]
  message: string
}): Promise<void> {
  const { res, ai, uid, conversationId, history, message } = opts
  writeSSE(res, { type: 'progress', message: 'Analyzing your message...' })

  const executeFn = makeExecutor(uid, conversationId, res)

  // Root observation for the request: provider generations and tool spans
  // nest under it via OTel context. Trace-level input/output are what the
  // Langfuse UI lists; the span's own input/output mirror them.
  await startActiveObservation('chat', async (span) => {
    span.updateTrace({ name: 'chat', input: message, metadata: { conversationId } })
    span.update({ input: message })
    try {
      let fullText = ''
      let suggestions: string[] | undefined
      for await (const item of ai.chatStream(history, message, executeFn)) {
        if (typeof item === 'string') {
          fullText += item
          writeSSE(res, { type: 'chunk', text: item })
        } else if (item.type === 'suggestions') {
          suggestions = item.items
          writeSSE(res, { type: 'suggestions', items: item.items })
        }
      }
      await db.addMessage(conversationId, 'assistant', fullText, suggestions)
      await db.updateConversationLastMessage(conversationId, fullText)
      span.updateTrace({ output: fullText })
      span.update({ output: fullText })
      writeSSE(res, { type: 'done' })
    } catch (err) {
      span.update({
        level: 'ERROR',
        statusMessage: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  })
}
```

Replace `withSSEErrorHandling` with (flush happens before `res.end()` because Cloud Run throttles CPU once the response completes; a flush failure must never mask the real outcome):

```ts
async function withSSEErrorHandling(res: Response, work: () => Promise<void>): Promise<void> {
  try {
    await work()
  } catch (err) {
    console.error(err)
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' } as ErrorResponse)
    } else {
      writeSSE(res, { type: 'error', message: 'Internal server error' })
    }
  } finally {
    try {
      await flushLangfuse()
    } catch (err) {
      console.error('[langfuse] flush failed:', err)
    }
    if (!res.writableEnded) res.end()
  }
}
```

If `span.updateTrace` does not exist on the installed SDK version, apply Known API-name risk #1.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/routes/conversations.tracing.test.ts`
Expected: PASS (3 tests). If the metadata assertion fails, apply Known API-name risk #2 (the key may be `langfuse.trace.metadata` holding JSON instead of a flattened key).

- [ ] **Step 5: Run the full suite**

Run: `npm test && npm run lint && npm run build`
Expected: all pass — existing `conversations.test.ts` must pass unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/routes/conversations.ts src/routes/conversations.tracing.test.ts
git commit -m "feat: open Langfuse root trace per chat request and flush before response end"
```

---

### Task 5: Startup wiring, env docs, deploy workflow

**Files:**
- Modify: `backend/src/index.ts`
- Modify: `backend/.env.example`
- Modify: `README.md` (repo root)
- Modify: `.github/workflows/backend.yml` (repo root)

**Interfaces:**
- Consumes: `initLangfuse`, `shutdownLangfuse` from `./config/langfuse` (Task 1).
- Produces: nothing consumed by other tasks.

`index.ts` is the process entry point with no test harness (nothing else in the repo tests it); it is verified by `npm run build` plus the manual smoke test in Task 6 rather than a unit test.

- [ ] **Step 1: Wire startup and shutdown**

Replace `backend/src/index.ts` with:

```ts
import { initializeApp } from 'firebase-admin/app'
import { initLangfuse, shutdownLangfuse } from './config/langfuse'
import { createApp } from './app'

initLangfuse()
initializeApp()

const port = Number(process.env.PORT) || 8080
const server = createApp().listen(port, () => {
  console.log(`Listening on port ${port}`)
})

process.on('SIGTERM', () => {
  server.close(() => {
    void shutdownLangfuse().finally(() => process.exit(0))
  })
})
```

- [ ] **Step 2: Document env vars**

Append to `backend/.env.example`:

```
LANGFUSE_PUBLIC_KEY=
LANGFUSE_SECRET_KEY=
LANGFUSE_BASE_URL=https://cloud.langfuse.com
LANGFUSE_TRACING_ENVIRONMENT=development
```

In `README.md`, add these rows to the "Environment variables (backend)" table:

```markdown
| `LANGFUSE_PUBLIC_KEY` | Langfuse public key (optional — tracing is disabled without it) |
| `LANGFUSE_SECRET_KEY` | Langfuse secret key (optional — tracing is disabled without it) |
| `LANGFUSE_BASE_URL` | Langfuse host, e.g. `https://cloud.langfuse.com` |
| `LANGFUSE_TRACING_ENVIRONMENT` | Trace environment tag: `development` locally, `production` on Cloud Run |
```

- [ ] **Step 3: Update the deploy workflow**

In `.github/workflows/backend.yml`, update the two flag lines in the "Deploy to Cloud Run" step (note: `LANGFUSE_BASE_URL` must match the region of the Langfuse project created in Task 6 — e.g. `https://jp.cloud.langfuse.com` for the Japan region):

```yaml
            --set-env-vars "FIREBASE_PROJECT_ID=corgi-8732c,FRONTEND_URL=https://corgi-8732c.web.app,GOOGLE_SEARCH_ENABLED=true,LANGFUSE_BASE_URL=https://cloud.langfuse.com,LANGFUSE_TRACING_ENVIRONMENT=production" \
            --set-secrets "ALLOWED_EMAIL=ALLOWED_EMAIL:latest,GEMINI_API_KEY=GEMINI_API_KEY:latest,LANGFUSE_PUBLIC_KEY=LANGFUSE_PUBLIC_KEY:latest,LANGFUSE_SECRET_KEY=LANGFUSE_SECRET_KEY:latest"
```

- [ ] **Step 4: Verify**

Run: `npm test && npm run lint && npm run build`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts .env.example ../README.md ../.github/workflows/backend.yml
git commit -m "feat: wire Langfuse init/shutdown and deploy config"
```

---

### Task 6: Manual setup and end-to-end verification

These steps need the user's browser/accounts. The GCP secrets (step 3) **must exist before the deploy in step 4**, or Cloud Run deployment fails on the missing secret references.

- [ ] **Step 1 (user): Create the Langfuse Cloud project**

Sign up at https://cloud.langfuse.com (pick the region — Japan `jp.cloud.langfuse.com` has the lowest latency from Tokyo), create a project (e.g. `corgi`), and copy the public key (`pk-lf-…`) and secret key (`sk-lf-…`) from Project Settings → API Keys.

- [ ] **Step 2: Local smoke test**

Add to `backend/.env`: the two keys, `LANGFUSE_BASE_URL` for the chosen region, and `LANGFUSE_TRACING_ENVIRONMENT=development`. Note: nothing in the backend loads `.env` itself (no dotenv); the vars must reach the process the same way `GEMINI_API_KEY` does today (e.g. exported in the shell). Because tracing silently no-ops without keys, "no traces in the UI" during this smoke test most likely means the vars weren't loaded. Then `npm run dev`, send a chat message from the frontend (or curl), including one that triggers a tool (e.g. "Give me the Hacker News briefing"). In the Langfuse UI verify: a `chat` trace containing `gemini-chat`, a `tool:get_hacker_news_briefing` span, `gemini-chat-followup`, plus a separate `generate-title` trace — all with token counts.

- [ ] **Step 3: Create GCP secrets**

```bash
printf '%s' 'pk-lf-…' | gcloud secrets create LANGFUSE_PUBLIC_KEY --data-file=- --project corgi-8732c
printf '%s' 'sk-lf-…' | gcloud secrets create LANGFUSE_SECRET_KEY --data-file=- --project corgi-8732c
```

Grant the Cloud Run runtime service account access (find it with `gcloud run services describe corgi-backend --region asia-northeast1 --project corgi-8732c --format 'value(spec.template.spec.serviceAccountName)'`; an empty value means the Compute Engine default SA `<project-number>-compute@developer.gserviceaccount.com`):

```bash
gcloud secrets add-iam-policy-binding LANGFUSE_PUBLIC_KEY --project corgi-8732c \
  --member "serviceAccount:<runtime-sa>" --role roles/secretmanager.secretAccessor
gcloud secrets add-iam-policy-binding LANGFUSE_SECRET_KEY --project corgi-8732c \
  --member "serviceAccount:<runtime-sa>" --role roles/secretmanager.secretAccessor
```

- [ ] **Step 4: Deploy and verify production**

Merge/push to `main` (per the user's workflow: push means confirming the GitHub Actions deploy succeeds). After deploy, send a chat message in the production app and confirm the trace appears in Langfuse with `environment: production`.

- [ ] **Step 5 (user): Check model pricing**

In Langfuse: Settings → Models. If `gemini-3.5-flash` / `gemini-2.5-flash-lite` are missing from the price list, add custom model definitions with current Gemini API prices so cost columns populate.
