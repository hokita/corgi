import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai'
import type { Content, Part, Tool, ToolConfig } from '@google/generative-ai'
import type { AIProvider, Message, StreamItem, FunctionExecutor } from './AIProvider'
import { GEMINI_CHAT_MODEL } from '../config/gemini'
import { CHAT_SYSTEM_PROMPT } from '../prompts/chat'

const functionTools = {
  functionDeclarations: [
    {
      name: 'suggest_options',
      description:
        'Call at the end of your response to suggest next steps or options for the user to choose from as buttons.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          items: {
            type: SchemaType.ARRAY,
            items: { type: SchemaType.STRING },
            description: '2 to 4 short button labels',
          },
        },
        required: ['items'],
      },
    },
    {
      name: 'save_english_mistake',
      description:
        "Save an English learning point when the user's message contains a grammar mistake, unnatural phrasing, wrong preposition, article error, or word choice issue worth reviewing later — OR when the message is grammatically correct but a native speaker would naturally phrase it differently. Only call for genuinely valuable learning points — skip trivial typos or very minor issues.",
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          originalText: {
            type: SchemaType.STRING,
            description: "The user's original phrasing",
          },
          correctedText: {
            type: SchemaType.STRING,
            description: 'The improved, natural English version',
          },
          category: {
            type: SchemaType.STRING,
            description: 'One of: grammar, word-choice, preposition, article, phrasing',
          },
          severity: {
            type: SchemaType.STRING,
            description: 'One of: low, medium, high',
          },
          patternKey: {
            type: SchemaType.STRING,
            description: 'A reusable snake_case pattern identifier, e.g. by_gerund_for_method',
          },
          type: {
            type: SchemaType.STRING,
            description:
              '"mistake" if the original was grammatically wrong, "suggestion" if it was already correct but could sound more natural',
          },
        },
        required: ['originalText', 'correctedText', 'category', 'severity', 'patternKey', 'type'],
      },
    },
    {
      name: 'get_english_mistakes',
      description:
        'Fetch the user\'s saved English learning points from the database. Call this when the user asks to review their mistakes, e.g. "show me today\'s mistakes" or "review my grammar errors this week".',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          startDate: {
            type: SchemaType.STRING,
            description: 'ISO date string (YYYY-MM-DD) for the start of the date range, inclusive',
          },
          endDate: {
            type: SchemaType.STRING,
            description: 'ISO date string (YYYY-MM-DD) for the end of the date range, inclusive',
          },
          category: {
            type: SchemaType.STRING,
            description:
              'Filter by category: grammar, word-choice, preposition, article, or phrasing',
          },
        },
        required: [],
      },
    },
    {
      name: 'get_hacker_news_briefing',
      description:
        'Fetch the current Hacker News front page and render a "Morning Coffee Briefing". Call when the user asks for HN news, a morning briefing, or a tech news digest.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {},
        required: [],
      },
    },
  ],
}

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
    const tools: Tool[] = [functionTools as Tool]
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
