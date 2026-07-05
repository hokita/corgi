import { GoogleGenerativeAI } from '@google/generative-ai'
import { startObservation } from '@langfuse/tracing'
import type { TitleGenerator } from './AIProvider'
import { GEMINI_TITLE_MODEL } from '../config/gemini'
import { toUsageDetails, errorMessage, toTraceValue } from '../config/langfuse'

export class GeminiTitleGenerator implements TitleGenerator {
  private client: GoogleGenerativeAI

  constructor(apiKey: string) {
    this.client = new GoogleGenerativeAI(apiKey)
  }

  async generateTitle(message: string): Promise<string> {
    const trace = startObservation('generate-title', { input: toTraceValue(message) })
    try {
      const model = this.client.getGenerativeModel({ model: GEMINI_TITLE_MODEL })
      const prompt =
        `Generate a short title (max 50 characters, no quotes, no punctuation at end) ` +
        `for a conversation that starts with this message: "${message}"\n` +
        `Return only the title, nothing else.`
      const generation = trace.startObservation(
        'gemini-title',
        { model: GEMINI_TITLE_MODEL, input: toTraceValue(prompt) },
        { asType: 'generation' }
      )
      let result
      try {
        result = await model.generateContent(prompt)
      } catch (err) {
        generation.update({ level: 'ERROR', statusMessage: errorMessage(err) }).end()
        throw err
      }
      const title = result.response.text().trim().slice(0, 50) || message.slice(0, 40)
      generation
        .update({
          output: toTraceValue(title),
          usageDetails: toUsageDetails(result.response.usageMetadata),
        })
        .end()
      trace.update({ output: JSON.stringify(title) }).end()
      return title
    } catch (err) {
      console.error('[GeminiTitleGenerator] failed to generate title:', err)
      const fallback = message.slice(0, 40)
      trace
        .update({
          output: toTraceValue(fallback),
          level: 'ERROR',
          statusMessage: errorMessage(err),
        })
        .end()
      return fallback
    }
  }
}
