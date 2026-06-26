import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai'
import type { IdeaCluster } from '../models/api'
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

const brainstormIdeasTool = {
  functionDeclarations: [
    {
      name: 'brainstorm_ideas',
      description:
        'Call when the user is exploring, generating, or brainstorming ideas. Do NOT call for factual questions, weather, or conversational messages.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          clusters: {
            type: SchemaType.ARRAY,
            items: {
              type: SchemaType.OBJECT,
              properties: {
                label: { type: SchemaType.STRING },
                ideas: {
                  type: SchemaType.ARRAY,
                  items: {
                    type: SchemaType.OBJECT,
                    properties: {
                      label: { type: SchemaType.STRING },
                      description: { type: SchemaType.STRING },
                    },
                    required: ['label', 'description'],
                  },
                },
              },
              required: ['label', 'ideas'],
            },
            description: '2 to 4 clusters of related ideas, each with 2 to 4 ideas',
          },
        },
        required: ['clusters'],
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
        'You are a helpful assistant. When the user is exploring, generating, or brainstorming ideas, call `brainstorm_ideas` with 2–4 clusters of related ideas (2–4 ideas each). When it would help the user choose a next step, call `suggest_options` at the end of your response with 2 to 4 short button labels.',
    })
  }

  async *chatStream(history: Message[], newMessage: string): AsyncIterable<StreamItem> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tools: any[] = [suggestOptionsTool, brainstormIdeasTool]
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

    let hasBrainstorm = false

    for await (const chunk of result.stream) {
      let hasFunctionCall = false
      for (const candidate of chunk.candidates ?? []) {
        for (const part of candidate.content?.parts ?? []) {
          if ('functionCall' in part) {
            const { name, args } = part.functionCall as { name: string; args: unknown }
            if (name === 'brainstorm_ideas') {
              hasFunctionCall = true
              hasBrainstorm = true
              const clusters = (args as { clusters?: IdeaCluster[] }).clusters
              if (Array.isArray(clusters) && clusters.length > 0) {
                yield { type: 'brainstorm', clusters }
                yield { type: 'suggestions', items: clusters.map((c) => c.label) }
              }
            } else if (name === 'suggest_options') {
              hasFunctionCall = true
              if (!hasBrainstorm) {
                const items = (args as { items?: string[] }).items
                if (Array.isArray(items) && items.length > 0) {
                  yield { type: 'suggestions', items }
                }
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
}
