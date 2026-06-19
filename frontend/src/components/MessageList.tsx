import { useEffect, useRef } from 'react'
import type { Message } from '../types'

interface Props { messages: Message[] }

export default function MessageList({ messages }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {messages.map((m, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
          <div style={{
            maxWidth: '80%',
            padding: '10px 14px',
            borderRadius: m.role === 'user' ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
            background: m.role === 'user' ? '#0084ff' : '#e9e9eb',
            color: m.role === 'user' ? '#fff' : '#000',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}>
            {m.content}
          </div>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  )
}
