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

async function* defaultStream() {
  yield 'AI reply'
}

const mockAI: AIProvider = {
  chatStream: vi.fn().mockReturnValue(defaultStream()),
}

function mockAuth(req: Request, _: Response, next: NextFunction) {
  req.uid = 'u1'
  next()
}

const app = express()
app.use(express.json())
app.use('/api/conversations', mockAuth, createConversationsRouter(mockAI))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(mockAI.chatStream).mockReturnValue(defaultStream())
})

function parseSSE(text: string): Array<{ type: string; [key: string]: unknown }> {
  return text
    .split('\n')
    .filter((l) => l.startsWith('data: '))
    .map((l) => JSON.parse(l.slice(6)))
}

describe('POST /api/conversations', () => {
  it('streams meta, chunk, and done events', async () => {
    async function* stream() {
      yield 'Hello'
      yield ' world'
    }
    vi.mocked(mockAI.chatStream).mockReturnValue(stream())
    const res = await request(app)
      .post('/api/conversations')
      .send({ message: 'Hello world' })
      .buffer(true)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('text/event-stream')
    const events = parseSSE(res.text)
    expect(events[0]).toEqual({ type: 'meta', conversationId: 'conv123', title: 'Hello world' })
    expect(events[1]).toEqual({ type: 'chunk', text: 'Hello' })
    expect(events[2]).toEqual({ type: 'chunk', text: ' world' })
    expect(events[3]).toEqual({ type: 'done' })
  })

  it('returns 400 JSON when message is missing', async () => {
    const res = await request(app).post('/api/conversations').send({})
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('message is required')
  })

  it('truncates title to 40 chars', async () => {
    await request(app)
      .post('/api/conversations')
      .send({ message: 'A'.repeat(60) })
      .buffer(true)
    expect(firestoreService.createConversation).toHaveBeenCalledWith('u1', 'A'.repeat(40))
  })

  it('saves full accumulated assistant message to Firestore', async () => {
    async function* stream() {
      yield 'Hello'
      yield ' world'
    }
    vi.mocked(mockAI.chatStream).mockReturnValue(stream())
    await request(app).post('/api/conversations').send({ message: 'Hi' }).buffer(true)
    expect(firestoreService.addMessage).toHaveBeenCalledWith('conv123', 'assistant', 'Hello world')
  })
})

describe('POST /api/conversations/:id/messages', () => {
  it('streams chunk and done events', async () => {
    async function* stream() {
      yield 'AI reply'
    }
    vi.mocked(mockAI.chatStream).mockReturnValue(stream())
    const res = await request(app)
      .post('/api/conversations/conv123/messages')
      .send({ message: 'Follow up' })
      .buffer(true)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('text/event-stream')
    const events = parseSSE(res.text)
    expect(events[0]).toEqual({ type: 'chunk', text: 'AI reply' })
    expect(events[1]).toEqual({ type: 'done' })
  })

  it('returns 404 JSON when conversation not found', async () => {
    vi.mocked(firestoreService.getConversation).mockResolvedValueOnce(null)
    const res = await request(app)
      .post('/api/conversations/missing/messages')
      .send({ message: 'hi' })
    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Conversation not found')
  })

  it('returns 400 JSON when message is missing', async () => {
    const res = await request(app).post('/api/conversations/conv123/messages').send({})
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('message is required')
  })

  it('saves full accumulated assistant message to Firestore', async () => {
    async function* stream() {
      yield 'Hello'
      yield ' world'
    }
    vi.mocked(mockAI.chatStream).mockReturnValue(stream())
    await request(app)
      .post('/api/conversations/conv123/messages')
      .send({ message: 'Follow up' })
      .buffer(true)
    expect(firestoreService.addMessage).toHaveBeenCalledWith('conv123', 'assistant', 'Hello world')
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
