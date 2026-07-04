# Langfuse Tracing — Design

**Date:** 2026-07-04
**Status:** Draft (pending review)

## Goal

Add LLM observability to the corgi backend with Langfuse:

1. **Debugging traces** — see every chat request end-to-end: prompts, streamed output, tool calls, the follow-up pass, and blocked responses. Past bugs (silent blocked streams, unanswered `suggest_options` calls) were invisible without this.
2. **Token usage & cost** — track tokens and cost per conversation across the chat and title models.
3. **Learning Langfuse** — hands-on experience with the current (v4, OTel-based) SDK.

## Decisions

| Decision | Choice |
|---|---|
| Hosting | Langfuse Cloud free (Hobby) tier |
| Scope | All LLM-related paths: chat stream (both passes), tool executions, title generation |
| SDK | Langfuse JS SDK v4 (`@langfuse/tracing` + `@langfuse/otel`, OpenTelemetry-based) |
| Instrumentation location | Inside `GeminiProvider` / `GeminiTitleGenerator`; route layer opens the root trace. No `AIProvider` interface change. |

## 1. Setup & configuration

- New backend dependencies: `@langfuse/tracing`, `@langfuse/otel`, `@opentelemetry/sdk-trace-node`.
- New module `backend/src/config/langfuse.ts`, imported early in `index.ts`. It initializes an OTel `NodeTracerProvider` with Langfuse's `LangfuseSpanProcessor` at startup.
- Env vars (all optional):
  - `LANGFUSE_PUBLIC_KEY`
  - `LANGFUSE_SECRET_KEY`
  - `LANGFUSE_BASE_URL` (Langfuse Cloud region URL)
  - `LANGFUSE_TRACING_ENVIRONMENT` (`production` on Cloud Run, `development` locally) — separates deployed traces from local ones in the UI.
- **No-op without keys:** if `LANGFUSE_PUBLIC_KEY`/`LANGFUSE_SECRET_KEY` are unset, no provider is registered and every tracing call is a silent no-op. Local dev and tests run unchanged with zero new required config.
- Document the vars in `.env.example` and the README env table; add them to the Cloud Run deploy workflow (as secrets).

## 2. Trace structure

**Chat request** — one trace per request, opened in the SSE route handler (`routes/conversations.ts`):

- Trace input: the new user message. Trace output: the final assistant text. Metadata: conversation ID.
- Nested observations, created inside `GeminiProvider.chatStream` via OTel context propagation:
  - **Generation** `gemini-chat` — the primary streaming call. Captures model name, system prompt + history + message as input, streamed visible text as output, token counts from `usageMetadata`.
  - **Span per tool execution** (e.g. `tool:get_hackernews_top`) — tool name, args, and result.
  - **Generation** `gemini-chat-followup` — the second pass, when tool calls fired and no text was produced. Same capture as the primary generation.

**Title generation** — its own small trace with one generation (model, input message, generated title, usage), created in `GeminiTitleGenerator`.

**Known risk:** OTel context propagation through async generators can be lossy across `yield` boundaries. Since the generator body executes during the caller's `next()` calls, wrapping the route's `for await` iteration loop in the active span context should keep children parented correctly. Verify during implementation; the fallback is a small, contained change in the route layer only.

## 3. Cost tracking

- Map `usageMetadata` fields (`promptTokenCount`, `candidatesTokenCount`, `thoughtsTokenCount`, `totalTokenCount`) to Langfuse usage fields on each generation.
- Langfuse computes cost from its model price list keyed on model name. If `gemini-3.5-flash` / `gemini-2.5-flash-lite` aren't in the built-in list, add custom model prices once in the Langfuse UI — no code change.

## 4. Error handling & flushing

- Blocked responses (`SAFETY`/`RECITATION`/`LANGUAGE` finish reasons, `promptFeedback.blockReason`) and stream errors are recorded on the active observation with level `ERROR`, so they are visible in Langfuse rather than only as an SSE error event.
- Tracing failures must never break chat: spans export asynchronously in the background, and all instrumentation is no-op without keys.
- **Cloud Run flushing:** Cloud Run throttles CPU after a response completes, so background export can be starved. `forceFlush` the span processor after each chat stream completes (before ending the SSE response) and in a `SIGTERM` shutdown hook.

## 5. Testing

Red/green TDD throughout:

- Tests register an OTel `InMemorySpanExporter` and assert that `chatStream` (against the mocked Gemini SDK, as existing provider tests already do) emits the expected spans: chat generation with token usage attributes, tool spans with name/args, follow-up generation when tools fire.
- Title generator test asserts its trace/generation.
- No-op test: with keys unset, chat works and no spans are exported.
- Existing tests must pass unchanged (instrumentation is transparent when unconfigured).

## Out of scope

- Prompt management and evals (Langfuse features, revisit later if wanted).
- Frontend changes — this is backend-only.
- Self-hosting Langfuse.
