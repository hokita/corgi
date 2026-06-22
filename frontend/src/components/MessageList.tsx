import { useEffect, useRef } from 'react'
import type { Message } from '../types'
import MarkdownMessage from './MarkdownMessage'

interface Props {
  messages: Message[]
}

export default function MessageList({ messages }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  return (
    <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
      {messages.map((m, i) => (
        <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
          <div
            className={`max-w-[80%] px-3.5 py-2.5 text-sm leading-relaxed break-words ${
              m.role === 'user'
                ? 'bg-[#0084ff] text-white rounded-[18px_18px_4px_18px] whitespace-pre-wrap'
                : 'bg-gray-200 text-gray-900 rounded-[18px_18px_18px_4px]'
            }`}
          >
            {m.role === 'user' ? m.content : <MarkdownMessage content={m.content} />}
          </div>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  )
}
