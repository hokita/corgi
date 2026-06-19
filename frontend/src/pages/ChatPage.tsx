import { useState, useEffect, useCallback } from 'react'
import { signOut } from 'firebase/auth'
import type { User } from 'firebase/auth'
import { auth } from '../firebase'
import { api } from '../api'
import type { Conversation, Message } from '../types'
import MessageList from '../components/MessageList'
import MessageInput from '../components/MessageInput'
import HistoryDrawer from '../components/HistoryDrawer'

interface Props { user: User }

export default function ChatPage({ user }: Props) {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [sending, setSending] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)

  useEffect(() => {
    api.listConversations().then(setConversations).catch(console.error)
  }, [])

  const loadConversation = useCallback(async (id: string) => {
    setActiveId(id)
    setDrawerOpen(false)
    const msgs = await api.getMessages(id)
    setMessages(msgs)
  }, [])

  async function handleSend(text: string) {
    setSending(true)
    try {
      const userMsg: Message = { role: 'user', content: text, createdAt: new Date().toISOString() }
      setMessages((prev) => [...prev, userMsg])

      if (!activeId) {
        const { conversationId, title, assistantMessage } = await api.createConversation(text)
        setMessages((prev) => [...prev, { role: 'assistant', content: assistantMessage, createdAt: new Date().toISOString() }])
        setActiveId(conversationId)
        setConversations((prev) => [
          { id: conversationId, title, lastMessage: assistantMessage, updatedAt: new Date().toISOString() },
          ...prev,
        ])
      } else {
        const { assistantMessage } = await api.sendMessage(activeId, text)
        setMessages((prev) => [...prev, { role: 'assistant', content: assistantMessage, createdAt: new Date().toISOString() }])
        setConversations((prev) =>
          prev.map((c) =>
            c.id === activeId
              ? { ...c, lastMessage: assistantMessage, updatedAt: new Date().toISOString() }
              : c
          )
        )
      }
    } catch (e) {
      console.error(e)
    } finally {
      setSending(false)
    }
  }

  async function handleDelete(id: string) {
    await api.deleteConversation(id)
    setConversations((prev) => prev.filter((c) => c.id !== id))
    if (activeId === id) {
      setActiveId(null)
      setMessages([])
    }
  }

  function handleNewChat() {
    setActiveId(null)
    setMessages([])
    setDrawerOpen(false)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', maxWidth: '600px', margin: '0 auto', position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid #e0e0e0', background: '#fff' }}>
        <button onClick={() => setDrawerOpen(true)} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', padding: '4px' }}>☰</button>
        <span style={{ fontWeight: 'bold' }}>corgi</span>
        <img
          src={user.photoURL ?? undefined}
          alt={user.displayName ?? 'user'}
          onClick={() => signOut(auth)}
          title="Sign out"
          style={{ width: '32px', height: '32px', borderRadius: '50%', cursor: 'pointer' }}
        />
      </div>

      {messages.length === 0 && !sending ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999' }}>
          Start a conversation
        </div>
      ) : (
        <MessageList messages={messages} />
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
    </div>
  )
}
