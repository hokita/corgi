import { useEffect, useRef, useState } from 'react'
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
  const generation = useRef(0)
  const activeIdRef = useRef(activeId)
  useEffect(() => {
    activeIdRef.current = activeId
  }, [activeId])

  function abandon() {
    generation.current += 1
    setSending(false)
    setCurrentStep(null)
  }

  async function send(text: string) {
    if (sending) return
    const myGeneration = ++generation.current
    const isCurrent = () => generation.current === myGeneration
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
      if (!isCurrent()) return
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
      if (!isCurrent()) return
      setCurrentStep(null)
      setMessages((prev) => prev.slice(0, -1))
      setSending(false)
      showToast(message)
    }

    let conversationId = activeId ?? ''
    let accumulated = ''
    const callbacks: StreamCallbacks = {
      onMeta: ({ conversationId: newId, title }) => {
        conversationId = newId
        setConversations((prev) => [
          { id: newId, title, lastMessage: '', updatedAt: new Date().toISOString() },
          ...prev,
        ])
        if (isCurrent()) setActiveId(newId)
      },
      onChunk: (chunk) => {
        accumulated += chunk
        appendChunk(chunk)
      },
      onSuggestions: (items) => {
        if (!isCurrent()) return
        setMessages((prev) => {
          const msgs = [...prev]
          msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], suggestions: items }
          return msgs
        })
      },
      onProgress: (step) => {
        if (isCurrent()) setCurrentStep(step)
      },
      onDone: () => {
        setConversations((prev) =>
          prev.map((c) =>
            c.id === conversationId
              ? { ...c, lastMessage: accumulated, updatedAt: new Date().toISOString() }
              : c
          )
        )
        if (!isCurrent()) {
          if (activeIdRef.current === conversationId) {
            const generationAtRefetch = generation.current
            api
              .getMessages(conversationId)
              .then((msgs) => {
                if (generation.current === generationAtRefetch) setMessages(msgs)
              })
              .catch(() => {})
          }
          return
        }
        setCurrentStep(null)
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

  return { sending, currentStep, send, abandon }
}
