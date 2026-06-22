import { Router } from 'express'
import type { AIProvider } from '../providers/AIProvider'
import { OverloadedError } from '../errors'
import type {
  CreateConversationRequest,
  CreateConversationResponse,
  SendMessageRequest,
  SendMessageResponse,
  ConversationSummary,
  MessageResponse,
  ErrorResponse,
} from '../models/api'
import * as db from '../services/firestore'

export function createConversationsRouter(ai: AIProvider): Router {
  const router = Router()

  router.post<{}, CreateConversationResponse | ErrorResponse, CreateConversationRequest>(
    '/',
    async (req, res) => {
      try {
        const { message } = req.body
        const uid = req.uid!
        if (!message?.trim()) {
          res.status(400).json({ error: 'message is required' })
          return
        }
        const title = message.slice(0, 40)
        const conversationId = await db.createConversation(uid, title)
        await db.addMessage(conversationId, 'user', message)
        const assistantMessage = await ai.chat([], message)
        await db.addMessage(conversationId, 'assistant', assistantMessage)
        await db.updateConversationLastMessage(conversationId, assistantMessage)
        res.json({ conversationId, title, assistantMessage })
      } catch (err) {
        if (err instanceof OverloadedError) {
          res.status(529).json({ error: err.message })
          return
        }
        console.error(err)
        res.status(500).json({ error: 'Internal server error' })
      }
    }
  )

  router.post<{ id: string }, SendMessageResponse | ErrorResponse, SendMessageRequest>(
    '/:id/messages',
    async (req, res) => {
      try {
        const { message } = req.body
        const uid = req.uid!
        const { id } = req.params
        if (!message?.trim()) {
          res.status(400).json({ error: 'message is required' })
          return
        }
        const conversation = await db.getConversation(id, uid)
        if (!conversation) {
          res.status(404).json({ error: 'Conversation not found' })
          return
        }
        const history = await db.getMessages(id)
        const aiHistory = history.map(({ role, content }) => ({ role, content }))
        await db.addMessage(id, 'user', message)
        const assistantMessage = await ai.chat(aiHistory, message)
        await db.addMessage(id, 'assistant', assistantMessage)
        await db.updateConversationLastMessage(id, assistantMessage)
        res.json({ assistantMessage })
      } catch (err) {
        if (err instanceof OverloadedError) {
          res.status(529).json({ error: err.message })
          return
        }
        console.error(err)
        res.status(500).json({ error: 'Internal server error' })
      }
    }
  )

  router.get<{}, ConversationSummary[] | ErrorResponse>('/', async (req, res) => {
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
  })

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
