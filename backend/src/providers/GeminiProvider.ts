import { GoogleGenerativeAI } from '@google/generative-ai'
import type {
  Content,
  EnhancedGenerateContentResponse,
  Part,
  Tool,
  ToolConfig,
} from '@google/generative-ai'
import type { AIProvider, Message, StreamItem, FunctionExecutor } from './AIProvider'
import { GEMINI_CHAT_MODEL } from '../config/gemini'
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

// The SDK's ToolConfig doesn't model this field; it is required when mixing
// built-in tools (googleSearch) with function calling.
const SERVER_SIDE_TOOL_CONFIG = { includeServerSideToolInvocations: true } as unknown as ToolConfig

interface StreamState {
  suggestions?: string[]
  hasText: boolean
}

// Appended after the functionResponse parts in the follow-up request. Right
// after consuming a large tool response the model tends to skip trailing
// function calls (or write the button labels as plain text), so the
// instruction is repeated at the very end of the context.
const FOLLOW_UP_REMINDER =
  'Reminder: after your text reply, end your turn by calling the `suggest_options` function. ' +
  'It must be a real function call — never write the button labels as plain text.'

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
        const text = chunk.text()
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
    const result = await chat.sendMessageStream(newMessage)

    const state: StreamState = { hasText: false }
    const pendingFunctionResponses: Array<{ name: string; response: unknown }> = []
    let executedToolCall = false
    // Capture raw parts from the stream. The SDK's ChatSession strips
    // thought_signature when merging chunks into its internal history, so we
    // preserve the raw parts ourselves for use in the follow-up call.
    const rawModelParts: Part[] = []

    yield* this.emitTextFromStream(result.stream, state, {
      rawParts: rawModelParts,
      onFunctionCall: async (name, args) => {
        executedToolCall = true
        const response = await executeFn(name, args)
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
    })

    // If Gemini only called functions and generated no text, send function results
    // back so Gemini produces its text response. Use model.generateContentStream
    // with manually-built history (not chat.sendMessageStream) so the raw model
    // parts — including thought_signature — are preserved in the request.
    if (executedToolCall && !state.hasText) {
      const manualHistory: Content[] = [
        ...toGeminiHistory(history),
        { role: 'user', parts: [{ text: newMessage }] },
        { role: 'model', parts: rawModelParts },
        {
          role: 'user',
          parts: [
            ...pendingFunctionResponses.map((r) => ({
              functionResponse: { name: r.name, response: r.response as object },
            })),
            { text: FOLLOW_UP_REMINDER },
          ],
        },
      ]
      const followUp = await model.generateContentStream({
        contents: manualHistory,
        tools,
        toolConfig: SERVER_SIDE_TOOL_CONFIG,
      })
      yield* this.emitTextFromStream(followUp.stream, state)
    }

    if (state.suggestions) {
      yield { type: 'suggestions', items: state.suggestions }
    }
  }
}
