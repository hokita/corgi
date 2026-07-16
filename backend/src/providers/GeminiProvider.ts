import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai'
import type {
  Content,
  EnhancedGenerateContentResponse,
  Part,
  ResponseSchema,
  Tool,
  ToolConfig,
} from '@google/generative-ai'
import { startObservation } from '@langfuse/tracing'
import type { AIProvider, Message, StreamItem, FunctionExecutor } from './AIProvider'
import { GEMINI_CHAT_MODEL, GEMINI_SUGGESTION_MODEL } from '../config/gemini'
import { toUsageDetails, errorMessage, toTraceValue } from '../config/langfuse'
import type { GeminiUsageMetadata } from '../config/langfuse'
import { CHAT_SYSTEM_PROMPT } from '../prompts/chat'
import { SUGGESTION_SYSTEM_PROMPT, buildSuggestionPrompt } from '../prompts/suggestions'
import { chatFunctionDeclarations } from '../tools/registry'
import { RepetitionGuard } from './repetitionGuard'

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

// The SDK's ToolConfig doesn't model this field; it is required when mixing
// built-in tools (googleSearch) with function calling.
const SERVER_SIDE_TOOL_CONFIG = { includeServerSideToolInvocations: true } as unknown as ToolConfig

// Structured-output schema for the dedicated suggestion model: a JSON object
// with a `suggestions` array of short button labels.
const SUGGESTION_RESPONSE_SCHEMA: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    suggestions: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
    },
  },
  required: ['suggestions'],
}

const MAX_SUGGESTIONS = 4

interface StreamState {
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

// Not an error: the partial text already streamed to the client is still
// useful, and throwing here would discard it for a generic error message.
// The notice keeps the truncation visible instead of silent.
export const TRUNCATION_NOTICE = '\n\n*⚠️ Response truncated — output token limit reached.*'

// Same reasoning as TRUNCATION_NOTICE: the text streamed before the loop set
// in is a real answer worth keeping, so the loop is cut off with a visible
// notice rather than the whole reply being discarded as an error.
export const REPETITION_NOTICE = '\n\n*⚠️ Response stopped — the model was repeating itself.*'

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
      abort?: () => void
    } = {}
  ): AsyncIterable<string> {
    let truncated = false
    const guard = new RepetitionGuard()
    for await (const chunk of stream) {
      assertChunkNotBlocked(chunk)
      if (chunk.candidates?.[0]?.finishReason === 'MAX_TOKENS') truncated = true
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
          if (hooks.onFunctionCall) {
            hasFunctionCall = true
            await hooks.onFunctionCall(name, args)
          }
        }
      }
      if (!hasFunctionCall) {
        const text = visibleText(chunk)
        if (text) {
          state.hasText = true
          // Check before yielding so the chunk that confirms the loop is
          // dropped instead of streamed. Returning alone is not enough to
          // stop paying for the loop: the SDK pumps the HTTP response to the
          // end even when nothing reads the stream, so Gemini would keep
          // generating (and billing) up to maxOutputTokens. The abort hook
          // cancels the request itself, which stops generation server-side.
          if (guard.append(text)) {
            console.warn('[gemini] repetition loop detected; aborting the request')
            hooks.abort?.()
            yield REPETITION_NOTICE
            return
          }
          yield text
        }
      }
    }
    if (truncated) {
      console.warn('[gemini] response hit maxOutputTokens and was truncated')
      // Only append to a pass that produced visible text; a truncated
      // function-call-only pass must not set hasText or the follow-up
      // call that writes the actual reply would be skipped.
      if (state.hasText) yield TRUNCATION_NOTICE
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
      // gemini-3.5-flash is a thinking model: thought tokens count against
      // maxOutputTokens, so long tool-driven replies (e.g. the HN briefing)
      // need far more headroom than the visible text alone would suggest.
      generationConfig: { maxOutputTokens: 15000 },
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
    // Aborting on repetition-loop detection cancels the underlying request so
    // Gemini stops generating; a loop always has visible text, so an aborted
    // primary pass never reaches the follow-up call and one controller can
    // serve both passes.
    const abort = new AbortController()
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
        input: toTraceValue([
          ...toGeminiHistory(history),
          { role: 'user', parts: [{ text: newMessage }] },
        ]),
      },
      { asType: 'generation' }
    )
    let primaryText = ''
    let followUpText = ''
    try {
      const result = await chat.sendMessageStream(newMessage, { signal: abort.signal })
      for await (const text of this.emitTextFromStream(result.stream, state, {
        rawParts: rawModelParts,
        abort: () => abort.abort(),
        onFunctionCall: async (name, args) => {
          executedToolCall = true
          const toolSpan = startObservation(
            `tool:${name}`,
            { input: toTraceValue(args) },
            { asType: 'tool' }
          )
          let response: unknown
          try {
            response = await executeFn(name, args)
          } catch (err) {
            toolSpan.update({ level: 'ERROR', statusMessage: errorMessage(err) }).end()
            throw err
          }
          toolSpan.update({ output: toTraceValue(response) }).end()
          pendingFunctionResponses.push({ name, response })
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
      .update({
        output: toTraceValue(primaryText),
        usageDetails: toUsageDetails(state.usageMetadata),
      })
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
        { model: GEMINI_CHAT_MODEL, input: toTraceValue(manualHistory) },
        { asType: 'generation' }
      )
      try {
        const followUp = await model.generateContentStream(
          {
            contents: manualHistory,
            tools,
            toolConfig: SERVER_SIDE_TOOL_CONFIG,
          },
          { signal: abort.signal }
        )
        // Nothing awaits this aggregate promise; on abort it rejects, and an
        // unobserved rejection would crash the process. Swallowing it broadly
        // is safe: it is a tee of the stream consumed below, so any non-abort
        // error also reaches the for-await loop, which reports and rethrows.
        followUp.response?.catch(() => {})
        for await (const text of this.emitTextFromStream(followUp.stream, state, {
          abort: () => abort.abort(),
        })) {
          followUpText += text
          yield text
        }
      } catch (err) {
        followUpGeneration.update({ level: 'ERROR', statusMessage: errorMessage(err) }).end()
        throw err
      }
      followUpGeneration
        .update({
          output: toTraceValue(followUpText),
          usageDetails: toUsageDetails(state.usageMetadata),
        })
        .end()
    }

    // Suggestion buttons come from a separate, cheaper flash model rather than
    // an inline tool call on the main model: it keeps the chat prompt simple and
    // makes suggestions consistent instead of depending on the thinking model
    // remembering to call a tool. Only run it once there is a real reply to
    // suggest follow-ups for.
    const reply = primaryText + followUpText
    if (reply.trim()) {
      const suggestions = await this.generateSuggestions(history, newMessage, reply)
      if (suggestions.length > 0) {
        yield { type: 'suggestions', items: suggestions }
      }
    }
  }

  // Dedicated flash-model call that turns the finished reply into 2–4 tappable
  // button labels. Failures are swallowed: suggestions are a nice-to-have, and a
  // problem here must never discard or fail the reply that already streamed.
  private async generateSuggestions(
    history: Message[],
    newMessage: string,
    assistantReply: string
  ): Promise<string[]> {
    const prompt = buildSuggestionPrompt(history, newMessage, assistantReply)
    const generation = startObservation(
      'gemini-suggestions',
      { model: GEMINI_SUGGESTION_MODEL, input: toTraceValue(prompt) },
      { asType: 'generation' }
    )
    try {
      const model = this.client.getGenerativeModel({
        model: GEMINI_SUGGESTION_MODEL,
        systemInstruction: SUGGESTION_SYSTEM_PROMPT,
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: SUGGESTION_RESPONSE_SCHEMA,
        },
      })
      const result = await model.generateContent(prompt)
      const items = parseSuggestions(result.response.text())
      generation
        .update({
          output: toTraceValue(items),
          usageDetails: toUsageDetails(result.response.usageMetadata),
        })
        .end()
      return items
    } catch (err) {
      console.error('[gemini] failed to generate suggestions:', err)
      generation.update({ level: 'ERROR', statusMessage: errorMessage(err) }).end()
      return []
    }
  }
}

// Parses the suggestion model's JSON output into a clean list of button labels,
// tolerating malformed responses by returning an empty list.
function parseSuggestions(raw: string): string[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  const items = (parsed as { suggestions?: unknown }).suggestions
  if (!Array.isArray(items)) return []
  return items
    .filter((s): s is string => typeof s === 'string')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, MAX_SUGGESTIONS)
}
