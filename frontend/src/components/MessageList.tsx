import { useEffect, useRef } from 'react'
import type { Message } from '../types'
import MarkdownMessage from './MarkdownMessage'
import SuggestionButtons from './SuggestionButtons'
import BrainstormClusters from './BrainstormClusters'

interface Props {
  messages: Message[]
  onSuggestionClick?: (text: string) => void
}

export default function MessageList({ messages, onSuggestionClick }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  return (
    <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
      {messages.map((m, i) => {
        const nextMsg = messages[i + 1]
        const hasFollowUp = nextMsg?.role === 'user'
        const selectedItem =
          hasFollowUp && m.suggestions?.includes(nextMsg.content)
            ? nextMsg.content
            : undefined

        return (
          <div
            key={i}
            className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}
          >
            <div
              className={`max-w-[80%] px-3.5 py-2.5 text-sm leading-relaxed break-words ${
                m.role === 'user'
                  ? 'bg-[#0084ff] text-white rounded-[18px_18px_4px_18px] whitespace-pre-wrap'
                  : 'bg-gray-200 text-gray-900 rounded-[18px_18px_18px_4px]'
              }`}
            >
              {m.role === 'user' ? m.content : <MarkdownMessage content={m.content} />}
            </div>
            {m.role === 'assistant' && m.clusters && m.clusters.length > 0 && (
              <BrainstormClusters clusters={m.clusters} />
            )}
            {m.role === 'assistant' && m.suggestions && m.suggestions.length > 0 && (
              <SuggestionButtons
                items={m.suggestions}
                selectedItem={selectedItem}
                disabled={hasFollowUp}
                onSelect={onSuggestionClick ?? (() => {})}
              />
            )}
          </div>
        )
      })}
      <div ref={bottomRef} />
    </div>
  )
}
