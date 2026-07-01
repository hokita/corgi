import { GoogleGenerativeAI } from '@google/generative-ai'
import type { Content, Part, Tool, ToolConfig } from '@google/generative-ai'
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

export class GeminiProvider implements AIProvider {
  private client: GoogleGenerativeAI
  private googleSearch: boolean

  constructor(apiKey: string, options: GeminiProviderOptions = {}) {
    this.googleSearch = options.googleSearch ?? false
    this.client = new GoogleGenerativeAI(apiKey)
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
    if (this.googleSearch) tools.push({ googleSearch: {} } as unknown as Tool)
    const chat = model.startChat({
      history: history.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
      tools,
      // Required when mixing built-in tools (googleSearch) with function calling
      ...(this.googleSearch && {
        toolConfig: { includeServerSideToolInvocations: true } as never,
      }),
    })
    const result = await chat.sendMessageStream(newMessage)

    let suggestOptionsItems: string[] | undefined
    let hasText = false
    const pendingFunctionResponses: Array<{ name: string; response: unknown }> = []
    // Capture raw parts from the stream. The SDK's ChatSession strips
    // thought_signature when merging chunks into its internal history, so we
    // preserve the raw parts ourselves for use in the follow-up call.
    const rawModelParts: Part[] = []

    for await (const chunk of result.stream) {
      for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
        rawModelParts.push(part)
      }
      let hasFunctionCall = false
      for (const candidate of chunk.candidates ?? []) {
        for (const part of candidate.content?.parts ?? []) {
          if ('functionCall' in part) {
            const { name, args } = part.functionCall as { name: string; args: unknown }
            if (name === 'suggest_options') {
              hasFunctionCall = true
              const items = (args as { items?: string[] }).items
              if (Array.isArray(items) && items.length > 0) {
                suggestOptionsItems = items
              }
            } else {
              hasFunctionCall = true
              const response = await executeFn(name, args)
              pendingFunctionResponses.push({ name, response })
            }
          }
        }
      }
      if (!hasFunctionCall) {
        const text = chunk.text()
        if (text) {
          hasText = true
          yield text
        }
      }
    }

    // If Gemini only called functions and generated no text, send function results
    // back so Gemini produces its text response. Use model.generateContentStream
    // with manually-built history (not chat.sendMessageStream) so the raw model
    // parts — including thought_signature — are preserved in the request.
    if (pendingFunctionResponses.length > 0 && !hasText) {
      const manualHistory: Content[] = [
        ...history.map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        })),
        { role: 'user', parts: [{ text: newMessage }] },
        { role: 'model', parts: rawModelParts },
        {
          role: 'user',
          parts: pendingFunctionResponses.map((r) => ({
            functionResponse: { name: r.name, response: r.response as object },
          })),
        },
      ]
      const followUp = await model.generateContentStream({
        contents: manualHistory,
        tools,
        toolConfig: { includeServerSideToolInvocations: true } as unknown as ToolConfig,
      })
      for await (const chunk of followUp.stream) {
        let hasFunctionCall = false
        for (const candidate of chunk.candidates ?? []) {
          for (const part of candidate.content?.parts ?? []) {
            if ('functionCall' in part) {
              const { name, args } = part.functionCall as { name: string; args: unknown }
              if (name === 'suggest_options') {
                hasFunctionCall = true
                const items = (args as { items?: string[] }).items
                if (Array.isArray(items) && items.length > 0) {
                  suggestOptionsItems = items
                }
              }
            }
          }
        }
        if (!hasFunctionCall) {
          const text = chunk.text()
          if (text) yield text
        }
      }
    }

    if (suggestOptionsItems) {
      yield { type: 'suggestions', items: suggestOptionsItems }
    }
  }
}
