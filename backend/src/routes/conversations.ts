import { Router } from 'express'
import type { AIProvider } from '../providers/AIProvider'
import type {
  CreateConversationRequest,
  SendMessageRequest,
  ConversationSummary,
  MessageResponse,
  SSEEvent,
  ErrorResponse,
} from '../models/api'
import * as db from '../services/firestore'

function writeSSE(res: import('express').Response, event: SSEEvent) {
  res.write(`data: ${JSON.stringify(event)}\n\n`)
}

export function createConversationsRouter(ai: AIProvider): Router {
  const router = Router()

  router.post<Record<string, never>, unknown, CreateConversationRequest>('/', async (req, res) => {
    const { message } = req.body
    const uid = req.uid!
    if (!message?.trim()) {
      res.status(400).json({ error: 'message is required' } as ErrorResponse)
      return
    }
    const title = message.slice(0, 40)
    try {
      const conversationId = await db.createConversation(uid, title)
      await db.addMessage(conversationId, 'user', message)

      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')

      writeSSE(res, { type: 'meta', conversationId, title })
      writeSSE(res, { type: 'progress', message: 'Analyzing your message...' })

      let fullText = ''
      let suggestions: string[] | undefined
      for await (const item of ai.chatStream([], message)) {
        if (typeof item === 'string') {
          fullText += item
          writeSSE(res, { type: 'chunk', text: item })
        } else if (item.type === 'suggestions') {
          suggestions = item.items
          writeSSE(res, { type: 'suggestions', items: item.items })
        } else if (item.type === 'save_english_mistake') {
          await db.saveEnglishMistake(uid, conversationId, item.data)
          writeSSE(res, { type: 'progress', message: 'Saving learning point...' })
        }
      }
      await db.addMessage(conversationId, 'assistant', fullText, suggestions)
      await db.updateConversationLastMessage(conversationId, fullText)
      writeSSE(res, { type: 'progress', message: 'Done' })
      writeSSE(res, { type: 'done' })
    } catch (err) {
      console.error(err)
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' } as ErrorResponse)
      } else {
        writeSSE(res, { type: 'error', message: 'Internal server error' })
      }
    } finally {
      if (!res.writableEnded) res.end()
    }
  })

  router.post<{ id: string }, unknown, SendMessageRequest>('/:id/messages', async (req, res) => {
    const { message } = req.body
    const uid = req.uid!
    const { id } = req.params
    if (!message?.trim()) {
      res.status(400).json({ error: 'message is required' } as ErrorResponse)
      return
    }
    try {
      const conversation = await db.getConversation(id, uid)
      if (!conversation) {
        res.status(404).json({ error: 'Conversation not found' } as ErrorResponse)
        return
      }
      const history = await db.getMessages(id)
      const aiHistory = history.map(({ role, content }) => ({ role, content }))
      await db.addMessage(id, 'user', message)

      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')

      writeSSE(res, { type: 'progress', message: 'Analyzing your message...' })

      let fullText = ''
      let suggestions: string[] | undefined
      for await (const item of ai.chatStream(aiHistory, message)) {
        if (typeof item === 'string') {
          fullText += item
          writeSSE(res, { type: 'chunk', text: item })
        } else if (item.type === 'suggestions') {
          suggestions = item.items
          writeSSE(res, { type: 'suggestions', items: item.items })
        } else if (item.type === 'save_english_mistake') {
          await db.saveEnglishMistake(uid, id, item.data)
          writeSSE(res, { type: 'progress', message: 'Saving learning point...' })
        }
      }
      await db.addMessage(id, 'assistant', fullText, suggestions)
      await db.updateConversationLastMessage(id, fullText)
      writeSSE(res, { type: 'progress', message: 'Done' })
      writeSSE(res, { type: 'done' })
    } catch (err) {
      console.error(err)
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' } as ErrorResponse)
      } else {
        writeSSE(res, { type: 'error', message: 'Internal server error' })
      }
    } finally {
      if (!res.writableEnded) res.end()
    }
  })

  router.get<Record<string, never>, ConversationSummary[] | ErrorResponse>(
    '/',
    async (req, res) => {
      try {
        const uid = req.uid!
        const conversations = await db.listConversations(uid)
        res.json(
          conversations.map((c) => ({
            id: c.id,
            title: c.title,
            lastMessage: c.lastMessage,
            updatedAt: c.updatedAt.toDate().toISOString(),
          }))
        )
      } catch (err) {
        console.error(err)
        res.status(500).json({ error: 'Internal server error' })
      }
    }
  )

  router.get<{ id: string }, MessageResponse[] | ErrorResponse>(
    '/:id/messages',
    async (req, res) => {
      try {
        const uid = req.uid!
        const { id } = req.params
        const conversation = await db.getConversation(id, uid)
        if (!conversation) {
          res.status(404).json({ error: 'Conversation not found' })
          return
        }
        const messages = await db.getMessages(id)
        res.json(messages)
      } catch (err) {
        console.error(err)
        res.status(500).json({ error: 'Internal server error' })
      }
    }
  )

  router.delete<{ id: string }, ErrorResponse | void>('/:id', async (req, res) => {
    try {
      const uid = req.uid!
      const { id } = req.params
      const conversation = await db.getConversation(id, uid)
      if (!conversation) {
        res.status(404).json({ error: 'Conversation not found' })
        return
      }
      await db.deleteConversation(id)
      res.status(204).send()
    } catch (err) {
      console.error(err)
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  return router
}
