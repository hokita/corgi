import express from 'express'
import cors from 'cors'
import { authMiddleware } from './middleware/auth'
import { GeminiProvider } from './providers/GeminiProvider'
import { createConversationsRouter } from './routes/conversations'

export function createApp() {
  const app = express()
  // In dev (FRONTEND_URL unset), cors defaults to allow all origins — intentional for local development
  app.use(cors({ origin: process.env.FRONTEND_URL }))
  app.use(express.json())
  app.get('/health', (_req, res) => res.json({ ok: true }))
  app.use(
    '/api/conversations',
    authMiddleware,
    createConversationsRouter(
      new GeminiProvider(process.env.GEMINI_API_KEY!, {
        googleSearch: process.env.GOOGLE_SEARCH_ENABLED === 'true',
      })
    )
  )
  return app
}
