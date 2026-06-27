import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai'
import type { AIProvider, Message, StreamItem, FunctionExecutor } from './AIProvider'

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
        "Save an English learning point when the user's message contains a grammar mistake, unnatural phrasing, wrong preposition, article error, or word choice issue worth reviewing later. Only call for genuinely valuable learning points — skip trivial typos or very minor issues.",
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          originalText: {
            type: SchemaType.STRING,
            description: "The user's original phrasing that contains the mistake",
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
            description:
              'A reusable snake_case pattern identifier, e.g. by_gerund_for_method',
          },
        },
        required: ['originalText', 'correctedText', 'category', 'severity', 'patternKey'],
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
            description: 'Filter by category: grammar, word-choice, preposition, article, or phrasing',
          },
        },
        required: [],
      },
    },
  ],
}


export interface GeminiProviderOptions {
  googleSearch?: boolean
}

export class GeminiProvider implements AIProvider {
  private model: ReturnType<InstanceType<typeof GoogleGenerativeAI>['getGenerativeModel']>
  private googleSearch: boolean

  constructor(apiKey: string, options: GeminiProviderOptions = {}) {
    this.googleSearch = options.googleSearch ?? false
    const client = new GoogleGenerativeAI(apiKey)
    this.model = client.getGenerativeModel({
      model: 'gemini-3.5-flash',
      systemInstruction:
        'You are a helpful assistant. When the user is exploring or brainstorming, respond thoughtfully and call `suggest_options` with 2–4 thought-provoking follow-up questions that deepen their thinking. In other contexts, call `suggest_options` with 2–4 useful next steps or options. Additionally, when the user sends a message in English, silently analyze it for grammar mistakes, unnatural phrasing, wrong prepositions, article errors, or word choice issues. If you find a valuable learning point (not a trivial typo), call `save_english_mistake` — do not mention the correction in your reply unless the user explicitly asks about their English. When the user asks to review their English mistakes (e.g. "show me today\'s mistakes"), call `get_english_mistakes` with appropriate date and category filters.',
    })
  }

  async *chatStream(history: Message[], newMessage: string, executeFn: FunctionExecutor): AsyncIterable<StreamItem> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tools: any[] = [functionTools]
    if (this.googleSearch) tools.push({ googleSearch: {} })
    const chat = this.model.startChat({
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
    const rawModelParts: unknown[] = []

    for await (const chunk of result.stream) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const part of (chunk as any).candidates?.[0]?.content?.parts ?? []) {
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
      const manualHistory = [
        ...history.map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        })),
        { role: 'user', parts: [{ text: newMessage }] },
        { role: 'model', parts: rawModelParts },
        { role: 'user', parts: pendingFunctionResponses.map((r) => ({ functionResponse: r })) },
      ]
      const followUp = await this.model.generateContentStream(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { contents: manualHistory, tools, toolConfig: { includeServerSideToolInvocations: true } } as any
      )
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for await (const chunk of followUp.stream as any) {
        let hasFunctionCall = false
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const candidate of (chunk as any).candidates ?? []) {
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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const text = (chunk as any).text?.()
          if (text) yield text
        }
      }
    }

    if (suggestOptionsItems) {
      yield { type: 'suggestions', items: suggestOptionsItems }
    }
  }
}
