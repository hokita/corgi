import { GoogleGenerativeAI } from '@google/generative-ai'
import type { AIProvider, Message } from './AIProvider'

export class GeminiProvider implements AIProvider {
  private model: ReturnType<InstanceType<typeof GoogleGenerativeAI>['getGenerativeModel']>

  constructor(apiKey: string) {
    const client = new GoogleGenerativeAI(apiKey)
    this.model = client.getGenerativeModel({ model: 'gemini-2.5-flash-lite' })
  }

  async chat(history: Message[], newMessage: string): Promise<string> {
    const chat = this.model.startChat({
      history: history.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
    })
    const result = await chat.sendMessage(newMessage)
    return result.response.text()
  }
}
