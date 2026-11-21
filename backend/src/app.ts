import express from 'express'
import cors from 'cors'
import { authMiddleware } from './middleware/auth'
import { GeminiProvider } from './providers/GeminiProvider'
import { GeminiTitleGenerator } from './providers/GeminiTitleGenerator'
import type { AIProvider, TitleGenerator } from './providers/AIProvider'
import { createConversationsRouter } from './routes/conversations'

interface CreateAppOptions {
  ai?: AIProvider
  titleGen?: TitleGenerator
}

export function createApp(options: CreateAppOptions = {}) {
  const app = express()
  app.use(cors({ origin: process.env.FRONTEND_URL }))
  app.use(express.json())
  app.get('/health', (_req, res) => res.json({ ok: true }))
  const ai = options.ai ?? new GeminiProvider(process.env.GEMINI_API_KEY!, { googleSearch: true })
  const titleGen = options.titleGen ?? new GeminiTitleGenerator(process.env.GEMINI_API_KEY!)
  app.use('/api/conversations', authMiddleware, createConversationsRouter(ai, titleGen))
  return app
}
