import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import MessageList from './MessageList'
import type { Message } from '../types'

function msg(
  role: 'user' | 'assistant',
  content: string,
  suggestions?: string[],
  thinkingSteps?: string[]
): Message {
  return { role, content, createdAt: new Date().toISOString(), suggestions, thinkingSteps }
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
    // Only the copy button should be present; no suggestion buttons
    const buttons = screen.queryAllByRole('button')
    expect(buttons).toHaveLength(1)
    expect(buttons[0]).toHaveTextContent('Copy')
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
        messages={[msg('assistant', 'Choose:', ['Yes', 'No']), msg('user', 'Yes')]}
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

  it('renders the current thinking step above an assistant message', () => {
    render(
      <MessageList
        messages={[msg('assistant', 'Hello', undefined, ['Saving learning point...'])]}
      />
    )
    expect(screen.getByText('Saving learning point...')).toBeInTheDocument()
  })

  it('does not render thinking steps when thinkingSteps is absent', () => {
    render(<MessageList messages={[msg('assistant', 'Hello')]} />)
    expect(screen.queryByText('Analyzing your message...')).toBeNull()
  })

  it('does not render a balloon when the assistant message content is empty but has thinking steps', () => {
    render(
      <MessageList
        messages={[msg('assistant', '', undefined, ['Analyzing your message...'])]}
      />
    )
    expect(screen.getByText('Analyzing your message...')).toBeInTheDocument()
    expect(screen.queryByTestId('message-balloon')).toBeNull()
    expect(screen.queryByRole('button', { name: /copy/i })).toBeNull()
  })

  it('renders thinking steps only for the messages that have them', () => {
    render(
      <MessageList
        messages={[
          msg('assistant', 'First reply', undefined, ['Step A']),
          msg('user', 'Follow up'),
          msg('assistant', 'Second reply', undefined, ['Analyzing your message...']),
        ]}
      />
    )
    expect(screen.getAllByText('Analyzing your message...')).toHaveLength(1)
    expect(screen.getByText('Step A')).toBeInTheDocument()
  })
})
