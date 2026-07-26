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
  // Identifies the in-flight stream. Bumped whenever the user leaves the
  // conversation being streamed into (switches conversation, starts a new
  // chat) so the abandoned stream's callbacks stop touching UI state — the
  // request itself keeps running so the backend can still persist the reply.
  const generation = useRef(0)
  // Mirrors the activeId prop so callbacks running long after the render
  // that started them (e.g. onDone firing after the user has navigated
  // elsewhere and back) can see which conversation is on screen right now.
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
      // Only ever fired when creating a new conversation
      onMeta: ({ conversationId: newId, title }) => {
        conversationId = newId
        // The conversation was really created server-side, so it belongs in
        // the list regardless of whether the user is still looking at it.
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
        // Keep the sidebar's last-message preview accurate even if the user
        // has since navigated away from this conversation.
        setConversations((prev) =>
          prev.map((c) =>
            c.id === conversationId
              ? { ...c, lastMessage: accumulated, updatedAt: new Date().toISOString() }
              : c
          )
        )
        if (!isCurrent()) {
          // The user abandoned this stream but has since navigated back to
          // the same conversation. The reply was only persisted just now, so
          // the messages fetched on that earlier navigation don't include
          // it — refetch so it actually shows up.
          if (activeIdRef.current === conversationId) {
            // Snapshot the generation so a stale response can't overwrite
            // state that's moved on by the time it resolves — whether the
            // user navigated away or just started another send in this same
            // conversation (both bump `generation`).
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
