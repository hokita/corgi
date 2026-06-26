import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai'
import type { AIProvider, Message, StreamItem } from './AIProvider'

const suggestOptionsTool = {
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
        'You are a helpful assistant. When the user is exploring or brainstorming, respond thoughtfully and call `suggest_options` with 2–4 thought-provoking follow-up questions that deepen their thinking. In other contexts, call `suggest_options` with 2–4 useful next steps or options.',
    })
  }

  async *chatStream(history: Message[], newMessage: string): AsyncIterable<StreamItem> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tools: any[] = [suggestOptionsTool]
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

    for await (const chunk of result.stream) {
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

    if (suggestOptionsItems) {
      yield { type: 'suggestions', items: suggestOptionsItems }
    }
  }
}
