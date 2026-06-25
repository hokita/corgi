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
        'You are a helpful assistant. When it would help the user to choose a next step, call the suggest_options function at the end of your response with 2 to 4 short button labels.',
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
    })
    const result = await chat.sendMessageStream(newMessage)
    for await (const chunk of result.stream) {
      let hasFunctionCall = false
      for (const candidate of chunk.candidates ?? []) {
        for (const part of candidate.content?.parts ?? []) {
          if ('functionCall' in part && part.functionCall?.name === 'suggest_options') {
            hasFunctionCall = true
            const args = part.functionCall.args as { items?: string[] }
            if (Array.isArray(args?.items) && args.items.length > 0) {
              yield { type: 'suggestions', items: args.items }
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
}
