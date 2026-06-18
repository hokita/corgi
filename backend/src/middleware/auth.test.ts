import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import type { Request, Response } from 'express'

const mockVerifyIdToken = vi.fn()
vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({ verifyIdToken: mockVerifyIdToken }),
}))

import { authMiddleware } from './auth'
import type { AuthRequest } from './auth'

const app = express()
app.use(express.json())
app.get('/test', authMiddleware, (req: Request, res: Response) =>
  res.json({ uid: (req as AuthRequest).uid })
)

describe('authMiddleware', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.ALLOWED_EMAIL = 'owner@example.com'
  })

  it('returns 401 when Authorization header is missing', async () => {
    const res = await request(app).get('/test')
    expect(res.status).toBe(401)
  })

  it('returns 401 when token verification fails', async () => {
    mockVerifyIdToken.mockRejectedValue(new Error('Invalid token'))
    const res = await request(app)
      .get('/test')
      .set('Authorization', 'Bearer bad-token')
    expect(res.status).toBe(401)
  })

  it('returns 401 when email is not in allowlist', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'u1', email: 'other@example.com' })
    const res = await request(app)
      .get('/test')
      .set('Authorization', 'Bearer valid-token')
    expect(res.status).toBe(401)
  })

  it('calls next and sets uid when token is valid and email matches', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'u1', email: 'owner@example.com' })
    const res = await request(app)
      .get('/test')
      .set('Authorization', 'Bearer valid-token')
    expect(res.status).toBe(200)
    expect(res.body.uid).toBe('u1')
  })
})
