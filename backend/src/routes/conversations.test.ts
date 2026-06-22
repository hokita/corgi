import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import type { Request, Response, NextFunction } from 'express'
import type { AIProvider } from '../providers/AIProvider'

vi.mock('../services/firestore', () => ({
  createConversation: vi.fn().mockResolvedValue('conv123'),
  getConversation: vi.fn().mockResolvedValue({
    id: 'conv123',
    uid: 'u1',
    title: 'Hello world',
    lastMessage: '',
    createdAt: null,
    updatedAt: null,
  }),
  listConversations: vi.fn().mockResolvedValue([
    {
      id: 'conv123',
      uid: 'u1',
      title: 'Hello world',
      lastMessage: 'Hi',
      updatedAt: { toDate: () => new Date('2024-01-01') },
    },
  ]),
  addMessage: vi.fn().mockResolvedValue(undefined),
  getMessages: vi
    .fn()
    .mockResolvedValue(
      [] as Array<{ role: 'user' | 'assistant'; content: string; createdAt: string }>
    ),
  updateConversationLastMessage: vi.fn().mockResolvedValue(undefined),
  deleteConversation: vi.fn().mockResolvedValue(undefined),
}))

import { createConversationsRouter } from './conversations'
import * as firestoreService from '../services/firestore'
import { OverloadedError } from '../errors'

const mockAI: AIProvider = { chat: vi.fn().mockResolvedValue('AI reply') }

function mockAuth(req: Request, _: Response, next: NextFunction) {
  req.uid = 'u1'
  next()
}

const app = express()
app.use(express.json())
app.use('/api/conversations', mockAuth, createConversationsRouter(mockAI))

beforeEach(() => vi.clearAllMocks())

describe('POST /api/conversations', () => {
  it('creates conversation and returns assistantMessage', async () => {
    const res = await request(app).post('/api/conversations').send({ message: 'Hello world' })
    expect(res.status).toBe(200)
    expect(res.body.conversationId).toBe('conv123')
    expect(res.body.title).toBe('Hello world')
    expect(res.body.assistantMessage).toBe('AI reply')
  })

  it('returns 400 when message is missing', async () => {
    const res = await request(app).post('/api/conversations').send({})
    expect(res.status).toBe(400)
  })

  it('returns 529 when AI is overloaded', async () => {
    vi.mocked(mockAI.chat).mockRejectedValueOnce(new OverloadedError())
    const res = await request(app).post('/api/conversations').send({ message: 'Hello' })
    expect(res.status).toBe(529)
    expect(res.body.error).toMatch(/overloaded/i)
  })

  it('truncates title to 40 chars', async () => {
    await request(app)
      .post('/api/conversations')
      .send({ message: 'A'.repeat(60) })
    expect(firestoreService.createConversation).toHaveBeenCalledWith('u1', 'A'.repeat(40))
  })
})

describe('POST /api/conversations/:id/messages', () => {
  it('returns assistantMessage', async () => {
    const res = await request(app)
      .post('/api/conversations/conv123/messages')
      .send({ message: 'Follow up' })
    expect(res.status).toBe(200)
    expect(res.body.assistantMessage).toBe('AI reply')
  })

  it('returns 404 when conversation not found', async () => {
    vi.mocked(firestoreService.getConversation).mockResolvedValueOnce(null)
    const res = await request(app)
      .post('/api/conversations/missing/messages')
      .send({ message: 'hi' })
    expect(res.status).toBe(404)
  })

  it('returns 400 when message is missing', async () => {
    const res = await request(app).post('/api/conversations/conv123/messages').send({})
    expect(res.status).toBe(400)
  })

  it('returns 529 when AI is overloaded', async () => {
    vi.mocked(mockAI.chat).mockRejectedValueOnce(new OverloadedError())
    const res = await request(app)
      .post('/api/conversations/conv123/messages')
      .send({ message: 'hi' })
    expect(res.status).toBe(529)
    expect(res.body.error).toMatch(/overloaded/i)
  })
})

describe('GET /api/conversations', () => {
  it('returns conversation list', async () => {
    const res = await request(app).get('/api/conversations')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].id).toBe('conv123')
  })
})

describe('GET /api/conversations/:id/messages', () => {
  it('returns messages array', async () => {
    vi.mocked(firestoreService.getMessages).mockResolvedValueOnce([
      { role: 'user', content: 'Hello', createdAt: '2024-01-01T00:00:00.000Z' },
      { role: 'assistant', content: 'Hi there', createdAt: '2024-01-01T00:00:01.000Z' },
    ])
    const res = await request(app).get('/api/conversations/conv123/messages')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(2)
    expect(res.body[0].role).toBe('user')
  })
})

describe('DELETE /api/conversations/:id', () => {
  it('returns 204', async () => {
    const res = await request(app).delete('/api/conversations/conv123')
    expect(res.status).toBe(204)
  })

  it('returns 404 when conversation not found', async () => {
    vi.mocked(firestoreService.getConversation).mockResolvedValueOnce(null)
    const res = await request(app).delete('/api/conversations/missing')
    expect(res.status).toBe(404)
  })
})
