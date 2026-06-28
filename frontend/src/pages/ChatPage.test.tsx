import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { StreamCallbacks } from '../api'

vi.mock('../api', () => ({
  api: {
    listConversations: vi.fn(),
    getMessages: vi.fn(),
    createConversation: vi.fn(),
    sendMessage: vi.fn(),
    deleteConversation: vi.fn(),
  },
}))

vi.mock('../firebase', () => ({ auth: {} }))
vi.mock('firebase/auth', () => ({ signOut: vi.fn() }))

import { api } from '../api'
import ChatPage from './ChatPage'

const mockApi = api as {
  listConversations: ReturnType<typeof vi.fn>
  getMessages: ReturnType<typeof vi.fn>
  createConversation: ReturnType<typeof vi.fn>
  sendMessage: ReturnType<typeof vi.fn>
  deleteConversation: ReturnType<typeof vi.fn>
}

const fakeUser = {
  displayName: 'User',
  photoURL: null,
  email: 'test@example.com',
} as any

beforeEach(() => {
  vi.clearAllMocks()
  mockApi.listConversations.mockResolvedValue([])
})

describe('ChatPage error toasts', () => {
  it('shows "Failed to load conversations" when listConversations rejects', async () => {
    mockApi.listConversations.mockRejectedValue(new Error('Network error'))
    render(<ChatPage user={fakeUser} />)
    await waitFor(() =>
      expect(screen.getByText('Failed to load conversations')).toBeInTheDocument()
    )
  })

  it('shows "Failed to load messages" when getMessages rejects', async () => {
    mockApi.listConversations.mockResolvedValue([
      { id: 'c1', title: 'Chat 1', lastMessage: '', updatedAt: '' },
    ])
    mockApi.getMessages.mockRejectedValue(new Error('Network error'))
    render(<ChatPage user={fakeUser} />)
    fireEvent.click(screen.getByText('☰'))
    await waitFor(() => screen.getByText('Chat 1'))
    fireEvent.click(screen.getByText('Chat 1'))
    await waitFor(() =>
      expect(screen.getByText('Failed to load messages')).toBeInTheDocument()
    )
  })

  it('shows "Failed to delete conversation" when deleteConversation rejects', async () => {
    mockApi.listConversations.mockResolvedValue([
      { id: 'c1', title: 'Chat 1', lastMessage: '', updatedAt: '' },
    ])
    mockApi.deleteConversation.mockRejectedValue(new Error('Network error'))
    render(<ChatPage user={fakeUser} />)
    fireEvent.click(screen.getByText('☰'))
    await waitFor(() => screen.getByText('Chat 1'))
    fireEvent.click(screen.getByText('🗑'))
    await waitFor(() =>
      expect(screen.getByText('Failed to delete conversation')).toBeInTheDocument()
    )
  })

  it('shows backend error message when stream emits an error event', async () => {
    mockApi.createConversation.mockImplementation(
      (_msg: string, callbacks: StreamCallbacks) => {
        callbacks.onError('Title generation failed')
        return Promise.resolve()
      }
    )
    render(<ChatPage user={fakeUser} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'hello' } })
    fireEvent.click(screen.getByText('↑'))
    await waitFor(() =>
      expect(screen.getByText('Title generation failed')).toBeInTheDocument()
    )
  })

  it('shows "Failed to send message" when stream request throws', async () => {
    mockApi.createConversation.mockRejectedValue(new Error('Network error'))
    render(<ChatPage user={fakeUser} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'hello' } })
    fireEvent.click(screen.getByText('↑'))
    await waitFor(() =>
      expect(screen.getByText('Failed to send message')).toBeInTheDocument()
    )
  })
})
