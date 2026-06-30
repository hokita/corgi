import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import ThinkingProgress from './ThinkingProgress'

describe('ThinkingProgress', () => {
  it('renders the step', () => {
    render(<ThinkingProgress step="Analyzing your message..." />)
    expect(screen.getByText('Analyzing your message...')).toBeInTheDocument()
  })
})
