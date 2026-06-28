import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import SuggestionButtons from './SuggestionButtons'

describe('SuggestionButtons', () => {
  it('renders all button labels', () => {
    render(<SuggestionButtons items={['Yes', 'No']} disabled={false} onSelect={() => {}} />)
    expect(screen.getByText('Yes')).toBeInTheDocument()
    expect(screen.getByText('No')).toBeInTheDocument()
  })

  it('calls onSelect with the label when an active button is clicked', () => {
    const onSelect = vi.fn()
    render(<SuggestionButtons items={['Yes', 'No']} disabled={false} onSelect={onSelect} />)
    fireEvent.click(screen.getByText('Yes'))
    expect(onSelect).toHaveBeenCalledWith('Yes')
  })

  it('does not call onSelect when disabled', () => {
    const onSelect = vi.fn()
    render(<SuggestionButtons items={['Yes', 'No']} disabled={true} onSelect={onSelect} />)
    fireEvent.click(screen.getByText('Yes'))
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('applies filled blue style to selectedItem', () => {
    render(
      <SuggestionButtons
        items={['Yes', 'No']}
        selectedItem="Yes"
        disabled={true}
        onSelect={() => {}}
      />
    )
    expect(screen.getByText('Yes').closest('button')!.className).toContain('bg-[#0084ff]')
  })

  it('applies gray style to non-selected items when disabled', () => {
    render(
      <SuggestionButtons
        items={['Yes', 'No']}
        selectedItem="Yes"
        disabled={true}
        onSelect={() => {}}
      />
    )
    expect(screen.getByText('No').closest('button')!.className).toContain('text-gray-400')
  })

  it('applies blue outline style to all items when not disabled', () => {
    render(<SuggestionButtons items={['Yes', 'No']} disabled={false} onSelect={() => {}} />)
    expect(screen.getByText('Yes').closest('button')!.className).toContain('text-[#0084ff]')
    expect(screen.getByText('No').closest('button')!.className).toContain('text-[#0084ff]')
  })
})
