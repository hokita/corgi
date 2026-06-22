import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import MarkdownMessage from './MarkdownMessage'

describe('MarkdownMessage', () => {
  it('renders plain text content', () => {
    render(<MarkdownMessage content="Hello world" />)
    expect(screen.getByText('Hello world')).toBeInTheDocument()
  })

  it('renders bold text as <strong>', () => {
    render(<MarkdownMessage content="**bold**" />)
    expect(screen.getByText('bold').tagName).toBe('STRONG')
  })

  it('renders inline code with rose styling', () => {
    render(<MarkdownMessage content="`inline`" />)
    const code = screen.getByText('inline')
    expect(code.tagName).toBe('CODE')
    expect(code.className).toContain('text-rose-600')
  })

  it('renders a code block in a dark pre', () => {
    render(<MarkdownMessage content={'```\nconsole.log("hi")\n```'} />)
    expect(screen.getByText('console.log("hi")')).toBeInTheDocument()
    const pre = document.querySelector('pre')
    expect(pre?.className).toContain('bg-gray-900')
  })

  it('renders an unordered list', () => {
    render(<MarkdownMessage content={'- apple\n- banana'} />)
    expect(screen.getByText('apple')).toBeInTheDocument()
    expect(screen.getByText('banana')).toBeInTheDocument()
  })
})
