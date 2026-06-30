import { useState, useEffect, useCallback, useRef } from 'react'
import type { User } from 'firebase/auth'
import { api } from '../api'
import type { Conversation, Message } from '../types'
import MessageList from '../components/MessageList'
import MessageInput from '../components/MessageInput'
import HistoryDrawer from '../components/HistoryDrawer'
import UserMenu from '../components/UserMenu'
import MorningBriefingButton from '../components/MorningBriefingButton'

interface Props {
  user: User
}

export default function ChatPage({ user }: Props) {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [sending, setSending] = useState(false)
  const [currentStep, setCurrentStep] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function showToast(msg: string) {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast(msg)
    toastTimer.current = setTimeout(() => setToast(null), 4000)
  }

  useEffect(() => {
    api.listConversations().then(setConversations).catch(() => showToast('Failed to load conversations'))
  }, [])

  const loadConversation = useCallback(async (id: string) => {
    setActiveId(id)
    setDrawerOpen(false)
    try {
      const msgs = await api.getMessages(id)
      setMessages(msgs)
    } catch {
      showToast('Failed to load messages')
    }
  }, [])

  async function handleSend(text: string) {
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

    const onSuggestions = (items: string[]) => {
      setMessages((prev) => {
        const msgs = [...prev]
        msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], suggestions: items }
        return msgs
      })
    }

    const onError = (message: string) => {
      setCurrentStep(null)
      setMessages((prev) => prev.slice(0, -1))
      setSending(false)
      showToast(message)
    }

    try {
      if (!activeId) {
        let newId = ''
        let accumulated = ''
        await api.createConversation(text, {
          onMeta: ({ conversationId, title }) => {
            newId = conversationId
            setActiveId(conversationId)
            setConversations((prev) => [
              { id: conversationId, title, lastMessage: '', updatedAt: new Date().toISOString() },
              ...prev,
            ])
          },
          onChunk: (chunk) => {
            accumulated += chunk
            appendChunk(chunk)
          },
          onSuggestions,
          onProgress: setCurrentStep,
          onDone: () => {
            setCurrentStep(null)
            setConversations((prev) =>
              prev.map((c) =>
                c.id === newId
                  ? { ...c, lastMessage: accumulated, updatedAt: new Date().toISOString() }
                  : c
              )
            )
            setSending(false)
          },
          onError,
        })
      } else {
        const id = activeId
        let accumulated = ''
        await api.sendMessage(id, text, {
          onChunk: (chunk) => {
            accumulated += chunk
            appendChunk(chunk)
          },
          onSuggestions,
          onProgress: setCurrentStep,
          onDone: () => {
            setCurrentStep(null)
            setConversations((prev) =>
              prev.map((c) =>
                c.id === id
                  ? { ...c, lastMessage: accumulated, updatedAt: new Date().toISOString() }
                  : c
              )
            )
            setSending(false)
          },
          onError,
        })
      }
    } catch (e) {
      console.error(e)
      onError('Failed to send message')
    }
  }

  async function handleDelete(id: string) {
    try {
      await api.deleteConversation(id)
      setConversations((prev) => prev.filter((c) => c.id !== id))
      if (activeId === id) {
        setActiveId(null)
        setMessages([])
      }
    } catch {
      showToast('Failed to delete conversation')
    }
  }

  function handleNewChat() {
    setActiveId(null)
    setMessages([])
    setDrawerOpen(false)
  }

  return (
    <div className="flex flex-col h-dvh max-w-[600px] mx-auto relative">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-white">
        <button
          onClick={() => setDrawerOpen(true)}
          className="bg-transparent border-none text-xl cursor-pointer p-1 leading-none"
        >
          ☰
        </button>
        <button
          onClick={() => window.location.reload()}
          className="font-bold bg-transparent border-none cursor-pointer p-0 text-base"
        >
          corgi
        </button>
        <UserMenu user={user} />
      </div>

      {messages.length === 0 && !sending ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-gray-400">
          Start a conversation
          <MorningBriefingButton onSend={handleSend} disabled={sending} />
        </div>
      ) : (
        <MessageList
          messages={messages}
          onSuggestionClick={handleSend}
          currentStep={currentStep}
        />
      )}

      <MessageInput onSend={handleSend} disabled={sending} />

      {drawerOpen && (
        <HistoryDrawer
          conversations={conversations}
          activeId={activeId}
          onSelect={loadConversation}
          onDelete={handleDelete}
          onNewChat={handleNewChat}
          onClose={() => setDrawerOpen(false)}
        />
      )}

      {toast !== null && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-red-600 text-white px-4 py-2 rounded-lg shadow-lg z-50 text-sm whitespace-nowrap">
          {toast}
        </div>
      )}
    </div>
  )
}
