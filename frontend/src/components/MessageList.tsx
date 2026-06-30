import { useEffect, useRef, useState } from 'react'
import type { Message } from '../types'
import MarkdownMessage from './MarkdownMessage'
import SuggestionButtons from './SuggestionButtons'
import ThinkingProgress from './ThinkingProgress'

interface Props {
  messages: Message[]
  onSuggestionClick?: (text: string) => void
  currentStep?: string | null
}

export default function MessageList({ messages, onSuggestionClick, currentStep }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, currentStep])

  async function handleCopy(content: string, index: number) {
    await navigator.clipboard.writeText(content)
    setCopiedIndex(index)
    setTimeout(() => setCopiedIndex(null), 2000)
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
      {messages.map((m, i) => {
        const nextMsg = messages[i + 1]
        const hasFollowUp = nextMsg?.role === 'user'
        const selectedItem =
          hasFollowUp && m.suggestions?.includes(nextMsg.content) ? nextMsg.content : undefined
        const isLastAssistant = i === messages.length - 1 && m.role === 'assistant'
        return (
          <div
            key={i}
            className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}
          >
            {isLastAssistant && currentStep && (
              <ThinkingProgress steps={[currentStep]} />
            )}
            <div className={`max-w-[80%] group relative ${m.role === 'assistant' ? 'flex flex-col items-start' : ''}`}>
              {m.content !== '' && (
                <div
                  data-testid="message-balloon"
                  className={`px-3.5 py-2.5 text-sm leading-relaxed break-words max-w-full ${
                    m.role === 'user'
                      ? 'bg-[#0084ff] text-white rounded-[18px_18px_4px_18px] whitespace-pre-wrap'
                      : 'bg-gray-200 text-gray-900 rounded-[18px_18px_18px_4px]'
                  }`}
                >
                  {m.role === 'user' ? m.content : <MarkdownMessage content={m.content} />}
                </div>
              )}
              {m.role === 'assistant' && m.content !== '' && (
                <button
                  onClick={() => handleCopy(m.content, i)}
                  className="mt-1 flex items-center gap-1 px-2 py-0.5 text-xs text-gray-400 hover:text-gray-600 transition-opacity duration-150 rounded opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100"
                  title="Copy answer"
                >
                  {copiedIndex === i ? (
                    <>
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      Copied!
                    </>
                  ) : (
                    <>
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                      </svg>
                      Copy
                    </>
                  )}
                </button>
              )}
            </div>
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
