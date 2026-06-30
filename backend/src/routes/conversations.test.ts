import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import type { Request, Response, NextFunction } from 'express'
import type { AIProvider, TitleGenerator, FunctionExecutor } from '../providers/AIProvider'
import type { StreamItem } from '../providers/AIProvider'

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
  saveEnglishMistake: vi.fn().mockResolvedValue(undefined),
  listEnglishMistakes: vi.fn().mockResolvedValue([]),
}))

vi.mock('../services/hnCache', () => ({
  getHNStories: vi
    .fn()
    .mockResolvedValue([
      { id: '1', title: 'Test Story', url: 'https://example.com', points: 100, comments: 10 },
    ]),
}))

import { createConversationsRouter } from './conversations'
import * as firestoreService from '../services/firestore'
import * as hnCacheService from '../services/hnCache'

async function* defaultStream() {
  yield 'AI reply'
}

let capturedExecuteFn: FunctionExecutor | undefined

const mockAI: AIProvider = {
  chatStream: vi.fn().mockImplementation((_history, _msg, executeFn: FunctionExecutor) => {
    capturedExecuteFn = executeFn
    return defaultStream()
  }),
}

const mockTitleGen: TitleGenerator = {
  generateTitle: vi.fn().mockResolvedValue('Mock Title'),
}

function mockAuth(req: Request, _: Response, next: NextFunction) {
  req.uid = 'u1'
  next()
}

const app = express()
app.use(express.json())
app.use('/api/conversations', mockAuth, createConversationsRouter(mockAI, mockTitleGen))

beforeEach(() => {
  vi.clearAllMocks()
  capturedExecuteFn = undefined
  vi.mocked(mockAI.chatStream).mockImplementation((_history, _msg, executeFn: FunctionExecutor) => {
    capturedExecuteFn = executeFn
    return defaultStream()
  })
  vi.mocked(mockTitleGen.generateTitle).mockResolvedValue('Mock Title')
})

function parseSSE(text: string): Array<{ type: string; [key: string]: unknown }> {
  return text
    .split('\n')
    .filter((l) => l.startsWith('data: '))
    .map((l) => JSON.parse(l.slice(6)))
}

describe('POST /api/conversations', () => {
  it('streams meta, chunk, and done events', async () => {
    vi.mocked(mockAI.chatStream).mockImplementation((_h, _m, executeFn) => {
      capturedExecuteFn = executeFn
      return (async function* () {
        yield 'Hello'
        yield ' world'
      })()
    })
    const res = await request(app)
      .post('/api/conversations')
      .send({ message: 'Hello world' })
      .buffer(true)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('text/event-stream')
    const events = parseSSE(res.text)
    expect(events[0]).toEqual({ type: 'meta', conversationId: 'conv123', title: 'Mock Title' })
    expect(events).toContainEqual({ type: 'chunk', text: 'Hello' })
    expect(events).toContainEqual({ type: 'chunk', text: ' world' })
    expect(events[events.length - 1]).toEqual({ type: 'done' })
  })

  it('returns 400 JSON when message is missing', async () => {
    const res = await request(app).post('/api/conversations').send({})
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('message is required')
  })

  it('uses AI-generated title from titleGen', async () => {
    vi.mocked(mockTitleGen.generateTitle).mockResolvedValueOnce('Learning Japanese')
    await request(app)
      .post('/api/conversations')
      .send({ message: 'I want to learn Japanese' })
      .buffer(true)
    expect(mockTitleGen.generateTitle).toHaveBeenCalledWith('I want to learn Japanese')
    expect(firestoreService.createConversation).toHaveBeenCalledWith('u1', 'Learning Japanese')
  })

  it('saves full accumulated assistant message to Firestore', async () => {
    vi.mocked(mockAI.chatStream).mockImplementation((_h, _m, executeFn) => {
      capturedExecuteFn = executeFn
      return (async function* () {
        yield 'Hello'
        yield ' world'
      })()
    })
    await request(app).post('/api/conversations').send({ message: 'Hi' }).buffer(true)
    expect(firestoreService.addMessage).toHaveBeenCalledWith(
      'conv123',
      'assistant',
      'Hello world',
      undefined
    )
  })

  it('emits suggestions SSE event when AI yields suggestions', async () => {
    vi.mocked(mockAI.chatStream).mockImplementation((_h, _m, executeFn) => {
      capturedExecuteFn = executeFn
      return (async function* (): AsyncIterable<StreamItem> {
        yield 'Here are your options:'
        yield { type: 'suggestions', items: ['Yes', 'No'] }
      })()
    })
    const res = await request(app)
      .post('/api/conversations')
      .send({ message: 'Give me options' })
      .buffer(true)
    const events = parseSSE(res.text)
    expect(events).toContainEqual({ type: 'suggestions', items: ['Yes', 'No'] })
  })

  it('saves suggestions to Firestore with assistant message', async () => {
    vi.mocked(mockAI.chatStream).mockImplementation((_h, _m, executeFn) => {
      capturedExecuteFn = executeFn
      return (async function* (): AsyncIterable<StreamItem> {
        yield 'Choose:'
        yield { type: 'suggestions', items: ['Yes', 'No'] }
      })()
    })
    await request(app).post('/api/conversations').send({ message: 'Give me options' }).buffer(true)
    expect(firestoreService.addMessage).toHaveBeenCalledWith('conv123', 'assistant', 'Choose:', [
      'Yes',
      'No',
    ])
  })

  it('emits progress events around the response', async () => {
    const res = await request(app)
      .post('/api/conversations')
      .send({ message: 'Hello' })
      .buffer(true)
    const events = parseSSE(res.text)
    const progressEvents = events.filter((e) => e.type === 'progress')
    expect(progressEvents[0]).toEqual({ type: 'progress', message: 'Analyzing your message...' })
    expect(progressEvents[progressEvents.length - 1]).toEqual({ type: 'progress', message: 'Done' })
  })

  it('executor saves english mistake to Firestore and returns saved result', async () => {
    const mistakeData = {
      originalText: 'I go to school yesterday.',
      correctedText: 'I went to school yesterday.',
      category: 'grammar',
      severity: 'medium',
      patternKey: 'past_tense_for_past_action',
    }
    await request(app).post('/api/conversations').send({ message: 'Hi' }).buffer(true)
    const result = await capturedExecuteFn!('save_english_mistake', mistakeData)
    expect(firestoreService.saveEnglishMistake).toHaveBeenCalledWith('u1', 'conv123', mistakeData)
    expect(result).toEqual({ result: 'saved' })
  })

  it('executor emits progress SSE when saving english mistake', async () => {
    const mistakeData = {
      originalText: 'I go to school yesterday.',
      correctedText: 'I went to school yesterday.',
      category: 'grammar',
      severity: 'medium',
      patternKey: 'past_tense_for_past_action',
    }
    vi.mocked(mockAI.chatStream).mockImplementation((_h, _m, executeFn) => {
      capturedExecuteFn = executeFn
      return (async function* () {
        await executeFn('save_english_mistake', mistakeData)
        yield 'Good effort!'
      })()
    })
    const res = await request(app)
      .post('/api/conversations')
      .send({ message: 'I go to school yesterday.' })
      .buffer(true)
    const events = parseSSE(res.text)
    expect(events).toContainEqual({ type: 'progress', message: 'Saving learning point...' })
  })

  it('executor fetches mistakes from Firestore when called with get_english_mistakes', async () => {
    const mockMistakes = [
      {
        id: 'm1',
        originalText: 'I go',
        correctedText: 'I went',
        category: 'grammar',
        severity: 'medium',
        patternKey: 'past_tense',
        uid: 'u1',
        conversationId: 'conv123',
        createdAt: '2026-06-27T00:00:00.000Z',
      },
    ]
    vi.mocked(firestoreService.listEnglishMistakes).mockResolvedValueOnce(mockMistakes)
    await request(app).post('/api/conversations').send({ message: 'Hi' }).buffer(true)
    const result = await capturedExecuteFn!('get_english_mistakes', {
      startDate: '2026-06-27',
      category: 'grammar',
    })
    expect(firestoreService.listEnglishMistakes).toHaveBeenCalledWith('u1', {
      startDate: '2026-06-27',
      category: 'grammar',
    })
    expect(result).toEqual({ mistakes: mockMistakes })
  })

  it('executor emits progress SSE when fetching mistakes', async () => {
    vi.mocked(mockAI.chatStream).mockImplementation((_h, _m, executeFn) => {
      capturedExecuteFn = executeFn
      return (async function* () {
        await executeFn('get_english_mistakes', {})
        yield 'Here are your mistakes.'
      })()
    })
    const res = await request(app)
      .post('/api/conversations')
      .send({ message: 'Show my mistakes' })
      .buffer(true)
    const events = parseSSE(res.text)
    expect(events).toContainEqual({ type: 'progress', message: 'Fetching your mistakes...' })
  })

  it('executor fetches HN stories and returns format instructions for get_hacker_news_briefing', async () => {
    await request(app).post('/api/conversations').send({ message: 'Hi' }).buffer(true)
    const result = (await capturedExecuteFn!('get_hacker_news_briefing', {})) as {
      stories: unknown[]
      format_instructions: string
    }
    expect(hnCacheService.getHNStories).toHaveBeenCalled()
    expect(result.stories).toEqual([
      { id: '1', title: 'Test Story', url: 'https://example.com', points: 100, comments: 10 },
    ])
    expect(result.format_instructions).toContain('Morning Coffee Briefing')
  })

  it('executor emits progress SSE when fetching HN briefing', async () => {
    vi.mocked(mockAI.chatStream).mockImplementation((_h, _m, executeFn) => {
      capturedExecuteFn = executeFn
      return (async function* () {
        await executeFn('get_hacker_news_briefing', {})
        yield 'Here is your briefing.'
      })()
    })
    const res = await request(app)
      .post('/api/conversations')
      .send({ message: 'Give me the HN briefing' })
      .buffer(true)
    const events = parseSSE(res.text)
    expect(events).toContainEqual({
      type: 'progress',
      message: 'Fetching Hacker News front page...',
    })
  })
})

describe('POST /api/conversations/:id/messages', () => {
  it('streams chunk and done events', async () => {
    vi.mocked(mockAI.chatStream).mockImplementation((_h, _m, executeFn) => {
      capturedExecuteFn = executeFn
      return (async function* () {
        yield 'AI reply'
      })()
    })
    const res = await request(app)
      .post('/api/conversations/conv123/messages')
      .send({ message: 'Follow up' })
      .buffer(true)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('text/event-stream')
    const events = parseSSE(res.text)
    expect(events).toContainEqual({ type: 'chunk', text: 'AI reply' })
    expect(events[events.length - 1]).toEqual({ type: 'done' })
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
    vi.mocked(mockAI.chatStream).mockImplementation((_h, _m, executeFn) => {
      capturedExecuteFn = executeFn
      return (async function* () {
        yield 'Hello'
        yield ' world'
      })()
    })
    await request(app)
      .post('/api/conversations/conv123/messages')
      .send({ message: 'Follow up' })
      .buffer(true)
    expect(firestoreService.addMessage).toHaveBeenCalledWith(
      'conv123',
      'assistant',
      'Hello world',
      undefined
    )
  })

  it('emits suggestions SSE event when AI yields suggestions', async () => {
    vi.mocked(mockAI.chatStream).mockImplementation((_h, _m, executeFn) => {
      capturedExecuteFn = executeFn
      return (async function* (): AsyncIterable<StreamItem> {
        yield 'Pick one:'
        yield { type: 'suggestions', items: ['Option A', 'Option B'] }
      })()
    })
    const res = await request(app)
      .post('/api/conversations/conv123/messages')
      .send({ message: 'Give me options' })
      .buffer(true)
    const events = parseSSE(res.text)
    expect(events).toContainEqual({ type: 'suggestions', items: ['Option A', 'Option B'] })
  })

  it('saves suggestions to Firestore with assistant message', async () => {
    vi.mocked(mockAI.chatStream).mockImplementation((_h, _m, executeFn) => {
      capturedExecuteFn = executeFn
      return (async function* (): AsyncIterable<StreamItem> {
        yield 'Choose:'
        yield { type: 'suggestions', items: ['Option A', 'Option B'] }
      })()
    })
    await request(app)
      .post('/api/conversations/conv123/messages')
      .send({ message: 'Give me options' })
      .buffer(true)
    expect(firestoreService.addMessage).toHaveBeenCalledWith('conv123', 'assistant', 'Choose:', [
      'Option A',
      'Option B',
    ])
  })

  it('emits progress events around the response', async () => {
    const res = await request(app)
      .post('/api/conversations/conv123/messages')
      .send({ message: 'Hello' })
      .buffer(true)
    const events = parseSSE(res.text)
    const progressEvents = events.filter((e) => e.type === 'progress')
    expect(progressEvents[0]).toEqual({ type: 'progress', message: 'Analyzing your message...' })
    expect(progressEvents[progressEvents.length - 1]).toEqual({ type: 'progress', message: 'Done' })
  })

  it('executor saves english mistake to Firestore and returns saved result', async () => {
    const mistakeData = {
      originalText: 'I go to school yesterday.',
      correctedText: 'I went to school yesterday.',
      category: 'grammar',
      severity: 'medium',
      patternKey: 'past_tense_for_past_action',
    }
    await request(app)
      .post('/api/conversations/conv123/messages')
      .send({ message: 'Hi' })
      .buffer(true)
    const result = await capturedExecuteFn!('save_english_mistake', mistakeData)
    expect(firestoreService.saveEnglishMistake).toHaveBeenCalledWith('u1', 'conv123', mistakeData)
    expect(result).toEqual({ result: 'saved' })
  })

  it('executor fetches mistakes and emits progress for get_english_mistakes', async () => {
    vi.mocked(mockAI.chatStream).mockImplementation((_h, _m, executeFn) => {
      capturedExecuteFn = executeFn
      return (async function* () {
        await executeFn('get_english_mistakes', { startDate: '2026-06-27' })
        yield 'Here are your mistakes.'
      })()
    })
    const res = await request(app)
      .post('/api/conversations/conv123/messages')
      .send({ message: 'Show mistakes' })
      .buffer(true)
    expect(firestoreService.listEnglishMistakes).toHaveBeenCalledWith('u1', {
      startDate: '2026-06-27',
    })
    const events = parseSSE(res.text)
    expect(events).toContainEqual({ type: 'progress', message: 'Fetching your mistakes...' })
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
