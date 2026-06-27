import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import ThinkingProgress from './ThinkingProgress'

describe('ThinkingProgress', () => {
  it('renders each step', () => {
    render(<ThinkingProgress steps={['Analyzing your message...', 'Saving learning point...']} />)
    expect(screen.getByText('Analyzing your message...')).toBeInTheDocument()
    expect(screen.getByText('Saving learning point...')).toBeInTheDocument()
  })

  it('renders nothing when steps is empty', () => {
    const { container } = render(<ThinkingProgress steps={[]} />)
    expect(container.firstChild).toBeNull()
  })
})
