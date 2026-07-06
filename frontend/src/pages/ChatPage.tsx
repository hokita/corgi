import { useState, useEffect, useCallback } from 'react'
import type { User } from 'firebase/auth'
import { api } from '../api'
import type { Conversation, Message } from '../types'
import MessageList from '../components/MessageList'
import MessageInput from '../components/MessageInput'
import HistoryDrawer from '../components/HistoryDrawer'
import UserMenu from '../components/UserMenu'
import MorningBriefingButton from '../components/MorningBriefingButton'
import { useToast } from '../hooks/useToast'
import { useChatStream } from '../hooks/useChatStream'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faBars, faPenToSquare } from '@fortawesome/free-solid-svg-icons'

interface Props {
  user: User
}

export default function ChatPage({ user }: Props) {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [drawerOpen, setDrawerOpen] = useState(false)
  const { toast, showToast } = useToast()
  const {
    sending,
    currentStep,
    send: handleSend,
  } = useChatStream({
    activeId,
    setActiveId,
    setMessages,
    setConversations,
    showToast,
  })

  useEffect(() => {
    api
      .listConversations()
      .then(setConversations)
      .catch(() => showToast('Failed to load conversations'))
  }, [showToast])

  const loadConversation = useCallback(
    async (id: string) => {
      setActiveId(id)
      setDrawerOpen(false)
      try {
        const msgs = await api.getMessages(id)
        setMessages(msgs)
      } catch {
        showToast('Failed to load messages')
      }
    },
    [showToast]
  )

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
          aria-label="Toggle menu"
        >
          <FontAwesomeIcon icon={faBars} />
        </button>
        <button
          onClick={() => window.location.reload()}
          className="font-bold bg-transparent border-none cursor-pointer p-0 text-base"
        >
          corgi
        </button>
        <div className="flex items-center gap-1">
          <button
            onClick={handleNewChat}
            disabled={sending}
            className="bg-transparent border-none text-xl cursor-pointer p-1 leading-none disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="New chat"
          >
            <FontAwesomeIcon icon={faPenToSquare} />
          </button>
          <UserMenu user={user} />
        </div>
      </div>

      {messages.length === 0 && !sending ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-gray-400">
          Start a conversation
          <MorningBriefingButton onSend={handleSend} disabled={sending} />
        </div>
      ) : (
        <MessageList messages={messages} onSuggestionClick={handleSend} currentStep={currentStep} />
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
