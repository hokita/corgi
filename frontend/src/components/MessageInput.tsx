import { useState, useRef, useEffect } from 'react'

interface Props {
  onSend: (message: string) => void
  disabled: boolean
}

export default function MessageInput({ onSend, disabled }: Props) {
  const [text, setText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!disabled) textareaRef.current?.focus()
  }, [disabled])

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  function handleSend() {
    const trimmed = text.trim()
    if (!trimmed || disabled) return
    onSend(trimmed)
    setText('')
  }

  return (
    <div style={{
      display: 'flex', gap: '8px', padding: '12px',
      paddingBottom: 'max(12px, env(safe-area-inset-bottom))',
      borderTop: '1px solid #e0e0e0', background: '#fff',
    }}>
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder="Message..."
        rows={1}
        style={{
          flex: 1, resize: 'none', border: '1px solid #e0e0e0',
          borderRadius: '20px', padding: '10px 14px', fontSize: '16px',
          outline: 'none', fontFamily: 'inherit',
        }}
      />
      <button
        onClick={handleSend}
        disabled={disabled || !text.trim()}
        style={{
          width: '40px', height: '40px', borderRadius: '50%',
          background: '#0084ff', border: 'none', color: '#fff',
          fontSize: '18px', cursor: 'pointer', flexShrink: 0, alignSelf: 'flex-end',
        }}
      >
        ↑
      </button>
    </div>
  )
}
