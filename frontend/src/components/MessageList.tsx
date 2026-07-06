import { useEffect, useRef, useState } from 'react'
import type { Message } from '../types'
import MarkdownMessage from './MarkdownMessage'
import SuggestionButtons from './SuggestionButtons'
import ThinkingProgress from './ThinkingProgress'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCheck, faCopy } from '@fortawesome/free-solid-svg-icons'

interface Props {
  messages: Message[]
  onSuggestionClick?: (text: string) => void
  currentStep?: string | null
}

const BALLOON_BASE = 'px-3.5 py-2.5 text-sm leading-relaxed break-words max-w-full'
const BALLOON_USER = 'bg-[#0084ff] text-white rounded-[18px_18px_4px_18px] whitespace-pre-wrap'
const BALLOON_ASSISTANT = 'bg-gray-200 text-gray-900 rounded-[18px_18px_18px_4px]'

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
            {isLastAssistant && currentStep && m.content === '' && (
              <ThinkingProgress step={currentStep} />
            )}
            <div
              className={`max-w-[80%] group relative ${m.role === 'assistant' ? 'flex flex-col items-start' : ''}`}
            >
              {m.content !== '' && (
                <div
                  data-testid="message-balloon"
                  className={`${BALLOON_BASE} ${m.role === 'user' ? BALLOON_USER : BALLOON_ASSISTANT}`}
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
                      <FontAwesomeIcon icon={faCheck} className="w-3.5 h-3.5" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <FontAwesomeIcon icon={faCopy} className="w-3.5 h-3.5" />
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
