import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import HistoryDrawer from './HistoryDrawer'
import type { Conversation } from '../types'

function conv(id: string, title: string): Conversation {
  return { id, title, lastMessage: '', updatedAt: new Date().toISOString() }
}

describe('HistoryDrawer', () => {
  it('identifies each conversation row with a data-testid keyed by id', () => {
    render(
      <HistoryDrawer
        conversations={[conv('c1', 'Chat 1'), conv('c2', 'Chat 2')]}
        activeId={null}
        onSelect={() => {}}
        onDelete={() => {}}
        onNewChat={() => {}}
        onClose={() => {}}
      />
    )
    expect(screen.getByTestId('conversation-row-c1')).toHaveTextContent('Chat 1')
    expect(screen.getByTestId('conversation-row-c2')).toHaveTextContent('Chat 2')
  })

  it('scopes the delete button to its own row', () => {
    const onDelete = vi.fn()
    render(
      <HistoryDrawer
        conversations={[conv('c1', 'Chat 1'), conv('c2', 'Chat 2')]}
        activeId={null}
        onSelect={() => {}}
        onDelete={onDelete}
        onNewChat={() => {}}
        onClose={() => {}}
      />
    )
    const row = screen.getByTestId('conversation-row-c2')
    row.querySelector('button')!.click()
    expect(onDelete).toHaveBeenCalledWith('c2')
  })
})
