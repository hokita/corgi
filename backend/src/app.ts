import express from 'express'
import cors from 'cors'

export function createApp() {
  const app = express()
  app.use(cors({ origin: process.env.FRONTEND_URL }))
  app.use(express.json())
  app.get('/healthz', (_req, res) => res.json({ ok: true }))
  return app
}
