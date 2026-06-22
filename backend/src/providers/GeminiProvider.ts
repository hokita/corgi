import { GoogleGenerativeAI } from '@google/generative-ai'
import type { AIProvider, Message } from './AIProvider'

export class GeminiProvider implements AIProvider {
  private model: ReturnType<InstanceType<typeof GoogleGenerativeAI>['getGenerativeModel']>

  constructor(apiKey: string) {
    const client = new GoogleGenerativeAI(apiKey)
    this.model = client.getGenerativeModel({ model: 'gemini-2.5-flash-lite' })
  }

  async *chatStream(history: Message[], newMessage: string): AsyncIterable<string> {
    const chat = this.model.startChat({
      history: history.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
    })
    const result = await chat.sendMessageStream(newMessage)
    for await (const chunk of result.stream) {
      const text = chunk.text()
      if (text) yield text
    }
  }
}
