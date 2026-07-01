import { GoogleGenerativeAI } from '@google/generative-ai'
import type { TitleGenerator } from './AIProvider'
import { GEMINI_TITLE_MODEL } from '../config/gemini'

export class GeminiTitleGenerator implements TitleGenerator {
  private client: GoogleGenerativeAI

  constructor(apiKey: string) {
    this.client = new GoogleGenerativeAI(apiKey)
  }

  async generateTitle(message: string): Promise<string> {
    try {
      const model = this.client.getGenerativeModel({ model: GEMINI_TITLE_MODEL })
      const prompt =
        `Generate a short title (max 50 characters, no quotes, no punctuation at end) ` +
        `for a conversation that starts with this message: "${message}"\n` +
        `Return only the title, nothing else.`
      const result = await model.generateContent(prompt)
      const title = result.response.text().trim()
      return title.slice(0, 50) || message.slice(0, 40)
    } catch (err) {
      console.error('[GeminiTitleGenerator] failed to generate title:', err)
      return message.slice(0, 40)
    }
  }
}
