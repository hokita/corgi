import { GoogleGenerativeAI } from '@google/generative-ai'
import type { AIProvider, Message } from './AIProvider'
import { OverloadedError } from '../errors'

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
    try {
      const result = await chat.sendMessage(newMessage)
      return result.response.text()
    } catch (err) {
      if (isOverloadedError(err)) throw new OverloadedError()
      throw err
    }
  }
}

function isOverloadedError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  const status = (err as { status?: number }).status
  if (status === 503) return true
  const message = (err as { message?: string }).message ?? ''
  return /overloaded/i.test(message)
}
