import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import type { Request, Response, NextFunction } from 'express'
import {
  NodeTracerProvider,
  SimpleSpanProcessor,
  InMemorySpanExporter,
} from '@opentelemetry/sdk-trace-node'
import type { AIProvider, TitleGenerator, FunctionExecutor } from '../providers/AIProvider'

const exporter = new InMemorySpanExporter()
const tracerProvider = new NodeTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
})
tracerProvider.register()

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
  listConversations: vi.fn().mockResolvedValue([]),
  addMessage: vi.fn().mockResolvedValue(undefined),
  getMessages: vi.fn().mockResolvedValue([]),
  updateConversationLastMessage: vi.fn().mockResolvedValue(undefined),
  deleteConversation: vi.fn().mockResolvedValue(undefined),
  saveEnglishMistake: vi.fn().mockResolvedValue(undefined),
  listEnglishMistakes: vi.fn().mockResolvedValue([]),
}))

vi.mock('../services/hnCache', () => ({
  getHNStories: vi.fn().mockResolvedValue([]),
}))

const mockFlush = vi.fn().mockResolvedValue(undefined)
vi.mock('../config/langfuse', () => ({
  flushLangfuse: () => mockFlush(),
}))

import { createConversationsRouter } from './conversations'

async function* defaultStream() {
  yield 'AI reply'
}

const mockAI: AIProvider = {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  chatStream: vi.fn().mockImplementation((_h: unknown, _m: unknown, _e: FunctionExecutor) => {
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

function finishedSpan(name: string) {
  return exporter.getFinishedSpans().find((s) => s.name === name)
}

beforeEach(() => {
  vi.clearAllMocks()
  exporter.reset()
  vi.mocked(mockAI.chatStream).mockImplementation(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    (_h: unknown, _m: unknown, _e: FunctionExecutor) => defaultStream()
  )
})

describe('conversations route tracing', () => {
  it('wraps the chat stream in a root span with trace input and output', async () => {
    const res = await request(app)
      .post('/api/conversations/conv123/messages')
      .send({ message: 'Hi' })
      .buffer(true)
    expect(res.status).toBe(200)

    const root = finishedSpan('chat')
    expect(root).toBeDefined()
    expect(JSON.parse(String(root!.attributes['langfuse.trace.input']))).toBe('Hi')
    expect(JSON.parse(String(root!.attributes['langfuse.trace.output']))).toBe('AI reply')
    expect(root!.attributes['langfuse.trace.metadata.conversationId']).toBe('conv123')
  })

  it('flushes Langfuse after a chat request', async () => {
    await request(app)
      .post('/api/conversations/conv123/messages')
      .send({ message: 'Hi' })
      .buffer(true)
    expect(mockFlush).toHaveBeenCalled()
  })

  it('marks the root span as ERROR when the stream fails, and still flushes', async () => {
    vi.mocked(mockAI.chatStream).mockImplementation(() => {
      // eslint-disable-next-line require-yield
      return (async function* (): AsyncGenerator<string> {
        throw new Error('stream exploded')
      })()
    })
    const res = await request(app)
      .post('/api/conversations/conv123/messages')
      .send({ message: 'Hi' })
      .buffer(true)
    expect(res.text).toContain('error')

    const root = finishedSpan('chat')
    expect(root).toBeDefined()
    expect(root!.attributes['langfuse.observation.level']).toBe('ERROR')
    expect(mockFlush).toHaveBeenCalled()
  })
})
