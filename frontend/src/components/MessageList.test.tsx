import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import MessageList from './MessageList'
import type { Message } from '../types'

function msg(role: 'user' | 'assistant', content: string): Message {
  return { role, content, createdAt: new Date().toISOString() }
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
})
