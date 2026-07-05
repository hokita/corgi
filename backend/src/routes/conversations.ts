import { Router } from 'express'
import type { Request, Response } from 'express'
import type { AIProvider, TitleGenerator, FunctionExecutor, Message } from '../providers/AIProvider'
import type {
  CreateConversationRequest,
  SendMessageRequest,
  ConversationSummary,
  MessageResponse,
  SSEEvent,
  ErrorResponse,
} from '../models/api'
import * as db from '../services/firestore'
import { createFunctionExecutor } from '../tools/registry'
import { requireUid } from '../middleware/auth'
import { startActiveObservation, propagateAttributes } from '@langfuse/tracing'
import { flushLangfuse, errorMessage, toTraceValue } from '../config/langfuse'

function writeSSE(res: Response, event: SSEEvent) {
  res.write(`data: ${JSON.stringify(event)}\n\n`)
}

function makeExecutor(uid: string, conversationId: string, res: Response): FunctionExecutor {
  return createFunctionExecutor({
    uid,
    conversationId,
    emitProgress: (message) => writeSSE(res, { type: 'progress', message }),
  })
}

function beginSSE(res: Response) {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
}

async function streamAndPersist(opts: {
  res: Response
  ai: AIProvider
  uid: string
  conversationId: string
  history: Message[]
  message: string
}): Promise<void> {
  const { res, ai, uid, conversationId, history, message } = opts
  writeSSE(res, { type: 'progress', message: 'Analyzing your message...' })

  const executeFn = makeExecutor(uid, conversationId, res)

  // Root observation for the request: provider generations and tool spans
  // nest under it via OTel context. Trace-level input/output are what the
  // Langfuse UI lists; the span's own input/output mirror them.
  await startActiveObservation('chat', async (span) => {
    await propagateAttributes({ metadata: { conversationId } }, async () => {
      span.setTraceIO({ input: toTraceValue(message) })
      span.update({ input: toTraceValue(message) })
      try {
        let fullText = ''
        let suggestions: string[] | undefined
        for await (const item of ai.chatStream(history, message, executeFn)) {
          if (typeof item === 'string') {
            fullText += item
            writeSSE(res, { type: 'chunk', text: item })
          } else if (item.type === 'suggestions') {
            suggestions = item.items
            writeSSE(res, { type: 'suggestions', items: item.items })
          }
        }
        await db.addMessage(conversationId, 'assistant', fullText, suggestions)
        await db.updateConversationLastMessage(conversationId, fullText)
        span.setTraceIO({ output: toTraceValue(fullText) })
        span.update({ output: toTraceValue(fullText) })
        writeSSE(res, { type: 'done' })
      } catch (err) {
        span.update({
          level: 'ERROR',
          statusMessage: errorMessage(err),
        })
        throw err
      }
    })
  })
}

async function withSSEErrorHandling(res: Response, work: () => Promise<void>): Promise<void> {
  try {
    await work()
  } catch (err) {
    console.error(err)
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' } as ErrorResponse)
    } else {
      writeSSE(res, { type: 'error', message: 'Internal server error' })
    }
  } finally {
    try {
      await flushLangfuse()
    } catch (err) {
      console.error('[langfuse] flush failed:', err)
    }
    if (!res.writableEnded) res.end()
  }
}

function jsonHandler<P>(
  fn: (req: Request<P>, res: Response) => Promise<void>
): (req: Request<P>, res: Response) => Promise<void> {
  return async (req, res) => {
    try {
      await fn(req, res)
    } catch (err) {
      console.error(err)
      res.status(500).json({ error: 'Internal server error' })
    }
  }
}

export function createConversationsRouter(ai: AIProvider, titleGen: TitleGenerator): Router {
  const router = Router()

  router.post<Record<string, never>, unknown, CreateConversationRequest>('/', async (req, res) => {
    const { message } = req.body
    if (!message?.trim()) {
      res.status(400).json({ error: 'message is required' } as ErrorResponse)
      return
    }
    const title = await titleGen.generateTitle(message)
    await withSSEErrorHandling(res, async () => {
      const uid = requireUid(req)
      const conversationId = await db.createConversation(uid, title)
      await db.addMessage(conversationId, 'user', message)

      beginSSE(res)
      writeSSE(res, { type: 'meta', conversationId, title })

      await streamAndPersist({ res, ai, uid, conversationId, history: [], message })
    })
  })

  router.post<{ id: string }, unknown, SendMessageRequest>('/:id/messages', async (req, res) => {
    const { message } = req.body
    const { id } = req.params
    if (!message?.trim()) {
      res.status(400).json({ error: 'message is required' } as ErrorResponse)
      return
    }
    await withSSEErrorHandling(res, async () => {
      const uid = requireUid(req)
      const conversation = await db.getConversation(id, uid)
      if (!conversation) {
        res.status(404).json({ error: 'Conversation not found' } as ErrorResponse)
        return
      }
      const history = await db.getMessages(id)
      const aiHistory = history.map(({ role, content }) => ({ role, content }))
      await db.addMessage(id, 'user', message)

      beginSSE(res)

      await streamAndPersist({ res, ai, uid, conversationId: id, history: aiHistory, message })
    })
  })

  router.get(
    '/',
    jsonHandler(async (req, res) => {
      const uid = requireUid(req)
      const conversations = await db.listConversations(uid)
      const summaries: ConversationSummary[] = conversations.map((c) => ({
        id: c.id,
        title: c.title,
        lastMessage: c.lastMessage,
        updatedAt: c.updatedAt.toDate().toISOString(),
      }))
      res.json(summaries)
    })
  )

  router.get(
    '/:id/messages',
    jsonHandler<{ id: string }>(async (req, res) => {
      const uid = requireUid(req)
      const { id } = req.params
      const conversation = await db.getConversation(id, uid)
      if (!conversation) {
        res.status(404).json({ error: 'Conversation not found' })
        return
      }
      const messages: MessageResponse[] = await db.getMessages(id)
      res.json(messages)
    })
  )

  router.delete(
    '/:id',
    jsonHandler<{ id: string }>(async (req, res) => {
      const uid = requireUid(req)
      const { id } = req.params
      const conversation = await db.getConversation(id, uid)
      if (!conversation) {
        res.status(404).json({ error: 'Conversation not found' })
        return
      }
      await db.deleteConversation(id)
      res.status(204).send()
    })
  )

  return router
}
