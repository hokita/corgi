import { useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { api } from '../api'
import type { StreamCallbacks } from '../api'
import type { Conversation, Message } from '../types'

interface UseChatStreamArgs {
  activeId: string | null
  setActiveId: (id: string) => void
  setMessages: Dispatch<SetStateAction<Message[]>>
  setConversations: Dispatch<SetStateAction<Conversation[]>>
  showToast: (msg: string) => void
}

export function useChatStream({
  activeId,
  setActiveId,
  setMessages,
  setConversations,
  showToast,
}: UseChatStreamArgs) {
  const [sending, setSending] = useState(false)
  const [currentStep, setCurrentStep] = useState<string | null>(null)

  async function send(text: string) {
    if (sending) return
    setCurrentStep(null)
    setSending(true)
    const userMsg: Message = { role: 'user', content: text, createdAt: new Date().toISOString() }
    const placeholder: Message = {
      role: 'assistant',
      content: '',
      createdAt: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, userMsg, placeholder])

    const appendChunk = (chunk: string) => {
      setMessages((prev) => {
        const msgs = [...prev]
        msgs[msgs.length - 1] = {
          ...msgs[msgs.length - 1],
          content: msgs[msgs.length - 1].content + chunk,
        }
        return msgs
      })
    }

    const onError = (message: string) => {
      setCurrentStep(null)
      setMessages((prev) => prev.slice(0, -1))
      setSending(false)
      showToast(message)
    }

    let conversationId = activeId ?? ''
    let accumulated = ''
    const callbacks: StreamCallbacks = {
      // Only ever fired when creating a new conversation
      onMeta: ({ conversationId: newId, title }) => {
        conversationId = newId
        setActiveId(newId)
        setConversations((prev) => [
          { id: newId, title, lastMessage: '', updatedAt: new Date().toISOString() },
          ...prev,
        ])
      },
      onChunk: (chunk) => {
        accumulated += chunk
        appendChunk(chunk)
      },
      onSuggestions: (items) => {
        setMessages((prev) => {
          const msgs = [...prev]
          msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], suggestions: items }
          return msgs
        })
      },
      onProgress: setCurrentStep,
      onDone: () => {
        setCurrentStep(null)
        setConversations((prev) =>
          prev.map((c) =>
            c.id === conversationId
              ? { ...c, lastMessage: accumulated, updatedAt: new Date().toISOString() }
              : c
          )
        )
        setSending(false)
      },
      onError,
    }

    try {
      await (activeId
        ? api.sendMessage(activeId, text, callbacks)
        : api.createConversation(text, callbacks))
    } catch (e) {
      console.error(e)
      onError('Failed to send message')
    }
  }

  return { sending, currentStep, send }
}
