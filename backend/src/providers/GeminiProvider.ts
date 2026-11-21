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

const SERVER_SIDE_TOOL_CONFIG = { includeServerSideToolInvocations: true } as unknown as ToolConfig

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
const MAX_SUGGESTION_CHARACTERS = 80
const MAX_SUGGESTION_WORDS = 6
const SUGGESTION_MAX_OUTPUT_TOKENS = 128
const SUGGESTION_TIMEOUT_MS = 5_000

interface StreamState {
  hasText: boolean
  usageMetadata?: GeminiUsageMetadata
}

function visibleText(chunk: EnhancedGenerateContentResponse): string {
  return (chunk.candidates?.[0]?.content?.parts ?? [])
    .filter((p) => typeof p.text === 'string' && !(p as { thought?: boolean }).thought)
    .map((p) => p.text)
    .join('')
}

const BAD_FINISH_REASONS = ['SAFETY', 'RECITATION', 'LANGUAGE']

export const TRUNCATION_NOTICE = '\n\n*⚠️ Response truncated — output token limit reached.*'

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
      generationConfig: { maxOutputTokens: 15000 },
    })
    const tools: Tool[] = [{ functionDeclarations: chatFunctionDeclarations }]
    if (this.googleSearch) tools.push({ googleSearch: {} } as unknown as Tool)
    const chat = model.startChat({
      history: toGeminiHistory(history),
      tools,
      ...(this.googleSearch && { toolConfig: SERVER_SIDE_TOOL_CONFIG }),
    })

    const state: StreamState = { hasText: false }
    const abort = new AbortController()
    const pendingFunctionResponses: Array<{ name: string; response: unknown }> = []
    let executedToolCall = false
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

    if (executedToolCall && !state.hasText) {
      const manualHistory: Content[] = [
        ...toGeminiHistory(history),
        { role: 'user', parts: [{ text: newMessage }] },
        { role: 'model', parts: rawModelParts },
        {
          role: 'user',
          parts: pendingFunctionResponses.map((r) => ({
            functionResponse: { name: r.name, response: r.response as object },
          })),
        },
      ]
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

    const reply = primaryText + followUpText
    if (reply.trim()) {
      const suggestions = await this.generateSuggestions(history, newMessage, reply, abort.signal)
      if (suggestions.length > 0) {
        yield { type: 'suggestions', items: suggestions }
      }
    }
  }

  private async generateSuggestions(
    history: Message[],
    newMessage: string,
    assistantReply: string,
    requestSignal: AbortSignal
  ): Promise<string[]> {
    const prompt = buildSuggestionPrompt(history, newMessage, assistantReply)
    const generation = startObservation(
      'gemini-suggestions',
      { model: GEMINI_SUGGESTION_MODEL, input: toTraceValue(prompt) },
      { asType: 'generation' }
    )
    const abort = new AbortController()
    const abortSuggestion = () => abort.abort()
    requestSignal.addEventListener('abort', abortSuggestion, { once: true })
    if (requestSignal.aborted) abortSuggestion()
    const timeout = setTimeout(abortSuggestion, SUGGESTION_TIMEOUT_MS)
    try {
      const model = this.client.getGenerativeModel({
        model: GEMINI_SUGGESTION_MODEL,
        systemInstruction: SUGGESTION_SYSTEM_PROMPT,
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: SUGGESTION_RESPONSE_SCHEMA,
          maxOutputTokens: SUGGESTION_MAX_OUTPUT_TOKENS,
        },
      })
      const result = await model.generateContent(prompt, { signal: abort.signal })
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
    } finally {
      clearTimeout(timeout)
      requestSignal.removeEventListener('abort', abortSuggestion)
    }
  }
}

function parseSuggestions(raw: string): string[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  const items = (parsed as { suggestions?: unknown }).suggestions
  if (!Array.isArray(items)) return []
  const seen = new Set<string>()
  return items
    .filter((s): s is string => typeof s === 'string')
    .map((s) => s.trim())
    .filter(
      (s) =>
        s.length > 0 &&
        s.length <= MAX_SUGGESTION_CHARACTERS &&
        s.split(/\s+/).length <= MAX_SUGGESTION_WORDS
    )
    .filter((s) => {
      const key = s.toLocaleLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, MAX_SUGGESTIONS)
}
