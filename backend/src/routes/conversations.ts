import { Router } from 'express'
import type { AIProvider, TitleGenerator, FunctionExecutor } from '../providers/AIProvider'
import type {
  CreateConversationRequest,
  SendMessageRequest,
  ConversationSummary,
  MessageResponse,
  SSEEvent,
  ErrorResponse,
  EnglishMistakeData,
  GetMistakesParams,
} from '../models/api'
import * as db from '../services/firestore'
import { getHNStories } from '../services/hnCache'
import { HN_BRIEFING_PROMPT } from '../prompts/hackernews'

function writeSSE(res: import('express').Response, event: SSEEvent) {
  res.write(`data: ${JSON.stringify(event)}\n\n`)
}

function makeExecutor(
  uid: string,
  conversationId: string,
  res: import('express').Response
): FunctionExecutor {
  return async (name: string, args: unknown) => {
    if (name === 'save_english_mistake') {
      await db.saveEnglishMistake(uid, conversationId, args as EnglishMistakeData)
      writeSSE(res, { type: 'progress', message: 'Saving learning point...' })
      return { result: 'saved' }
    }
    if (name === 'get_english_mistakes') {
      writeSSE(res, { type: 'progress', message: 'Fetching your mistakes...' })
      const mistakes = await db.listEnglishMistakes(uid, args as GetMistakesParams)
      return { mistakes }
    }
    if (name === 'get_hacker_news_briefing') {
      writeSSE(res, { type: 'progress', message: 'Fetching Hacker News front page...' })
      const stories = await getHNStories()
      return { stories, format_instructions: HN_BRIEFING_PROMPT }
    }
    return { error: 'unknown function' }
  }
}

export function createConversationsRouter(ai: AIProvider, titleGen: TitleGenerator): Router {
  const router = Router()

  router.post<Record<string, never>, unknown, CreateConversationRequest>('/', async (req, res) => {
    const { message } = req.body
    const uid = req.uid!
    if (!message?.trim()) {
      res.status(400).json({ error: 'message is required' } as ErrorResponse)
      return
    }
    const title = await titleGen.generateTitle(message)
    try {
      const conversationId = await db.createConversation(uid, title)
      await db.addMessage(conversationId, 'user', message)

      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')

      writeSSE(res, { type: 'meta', conversationId, title })
      writeSSE(res, { type: 'progress', message: 'Analyzing your message...' })

      const executeFn = makeExecutor(uid, conversationId, res)

      let fullText = ''
      let suggestions: string[] | undefined
      for await (const item of ai.chatStream([], message, executeFn)) {
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

      const executeFn = makeExecutor(uid, id, res)

      let fullText = ''
      let suggestions: string[] | undefined
      for await (const item of ai.chatStream(aiHistory, message, executeFn)) {
        if (typeof item === 'string') {
          fullText += item
          writeSSE(res, { type: 'chunk', text: item })
        } else if (item.type === 'suggestions') {
          suggestions = item.items
          writeSSE(res, { type: 'suggestions', items: item.items })
        }
      }
      await db.addMessage(id, 'assistant', fullText, suggestions)
      await db.updateConversationLastMessage(id, fullText)
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
