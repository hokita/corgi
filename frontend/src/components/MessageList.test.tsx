import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import MessageList from './MessageList'
import type { Message } from '../types'

function msg(role: 'user' | 'assistant', content: string, suggestions?: string[]): Message {
  return { role, content, createdAt: new Date().toISOString(), suggestions }
}

describe('MessageList', () => {
  it('renders markdown for assistant messages', () => {
    render(<MessageList messages={[msg('assistant', '**bold**')]} />)
    expect(screen.getByText('bold').tagName).toBe('STRONG')
  })

  it('does not render markdown for user messages', () => {
    render(<MessageList messages={[msg('user', '**bold**')]} />)
    expect(screen.queryByText('bold')).toBeNull()
    expect(screen.getByText('**bold**')).toBeInTheDocument()
  })

  it('renders suggestion buttons below an assistant message', () => {
    render(
      <MessageList
        messages={[msg('assistant', 'Choose one:', ['Yes', 'No'])]}
        onSuggestionClick={() => {}}
      />
    )
    expect(screen.getByText('Yes')).toBeInTheDocument()
    expect(screen.getByText('No')).toBeInTheDocument()
  })

  it('does not render suggestion buttons for messages without suggestions', () => {
    render(<MessageList messages={[msg('assistant', 'Hello')]} onSuggestionClick={() => {}} />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('calls onSuggestionClick when an active button is clicked', () => {
    const onSuggestionClick = vi.fn()
    render(
      <MessageList
        messages={[msg('assistant', 'Choose:', ['Yes', 'No'])]}
        onSuggestionClick={onSuggestionClick}
      />
    )
    fireEvent.click(screen.getByText('Yes'))
    expect(onSuggestionClick).toHaveBeenCalledWith('Yes')
  })

  it('marks the matching button as selected when next message matches a suggestion', () => {
    render(
      <MessageList
        messages={[
          msg('assistant', 'Choose:', ['Yes', 'No']),
          msg('user', 'Yes'),
        ]}
        onSuggestionClick={() => {}}
      />
    )
    expect(screen.getByRole('button', { name: 'Yes' }).className).toContain('bg-[#0084ff]')
    expect(screen.getByText('No').closest('button')!.className).toContain('text-gray-400')
  })

  it('grays out all buttons when next user message does not match any suggestion', () => {
    render(
      <MessageList
        messages={[
          msg('assistant', 'Choose:', ['Yes', 'No']),
          msg('user', 'Something else entirely'),
        ]}
        onSuggestionClick={() => {}}
      />
    )
    expect(screen.getByText('Yes').closest('button')!.className).toContain('text-gray-400')
    expect(screen.getByText('No').closest('button')!.className).toContain('text-gray-400')
  })
})
