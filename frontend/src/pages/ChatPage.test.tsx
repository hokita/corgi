import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { User } from 'firebase/auth'
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
} as unknown as User

beforeEach(() => {
  vi.clearAllMocks()
  mockApi.listConversations.mockResolvedValue([])
})

describe('ChatPage title click', () => {
  it('renders the title as a button', async () => {
    render(<ChatPage user={fakeUser} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'corgi' })).toBeInTheDocument())
  })

  it('clicking the title triggers a page reload', async () => {
    const reload = vi.fn()
    vi.stubGlobal('location', { reload })

    render(<ChatPage user={fakeUser} />)
    fireEvent.click(screen.getByRole('button', { name: 'corgi' }))

    expect(reload).toHaveBeenCalledOnce()

    vi.unstubAllGlobals()
  })
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
    fireEvent.click(screen.getByRole('button', { name: 'Toggle menu' }))
    await waitFor(() => screen.getByText('Chat 1'))
    fireEvent.click(screen.getByText('Chat 1'))
    await waitFor(() => expect(screen.getByText('Failed to load messages')).toBeInTheDocument())
  })

  it('shows "Failed to delete conversation" when deleteConversation rejects', async () => {
    mockApi.listConversations.mockResolvedValue([
      { id: 'c1', title: 'Chat 1', lastMessage: '', updatedAt: '' },
    ])
    mockApi.deleteConversation.mockRejectedValue(new Error('Network error'))
    render(<ChatPage user={fakeUser} />)
    fireEvent.click(screen.getByRole('button', { name: 'Toggle menu' }))
    await waitFor(() => screen.getByText('Chat 1'))
    fireEvent.click(screen.getByRole('button', { name: 'Delete conversation' }))
    await waitFor(() =>
      expect(screen.getByText('Failed to delete conversation')).toBeInTheDocument()
    )
  })

  it('shows backend error message when stream emits an error event', async () => {
    mockApi.createConversation.mockImplementation((_msg: string, callbacks: StreamCallbacks) => {
      callbacks.onError('Title generation failed')
      return Promise.resolve()
    })
    render(<ChatPage user={fakeUser} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'hello' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await waitFor(() => expect(screen.getByText('Title generation failed')).toBeInTheDocument())
  })

  it('shows "Failed to send message" when stream request throws', async () => {
    mockApi.createConversation.mockRejectedValue(new Error('Network error'))
    render(<ChatPage user={fakeUser} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'hello' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await waitFor(() => expect(screen.getByText('Failed to send message')).toBeInTheDocument())
  })
})

describe('ChatPage switching conversations while a message is streaming', () => {
  it('re-enables the message input after switching away from a still-streaming conversation', async () => {
    let capturedCallbacks: StreamCallbacks | undefined
    mockApi.createConversation.mockImplementation((_msg: string, callbacks: StreamCallbacks) => {
      capturedCallbacks = callbacks
      return new Promise(() => {}) // simulates a request that never resolves (still streaming)
    })
    mockApi.listConversations.mockResolvedValue([
      { id: 'c1', title: 'Chat 1', lastMessage: '', updatedAt: '' },
    ])
    mockApi.getMessages.mockResolvedValue([{ role: 'assistant', content: 'existing answer' }])

    render(<ChatPage user={fakeUser} />)

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'new question' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await waitFor(() => expect(capturedCallbacks).toBeDefined())
    expect(screen.getByRole('textbox')).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Toggle menu' }))
    await waitFor(() => screen.getByText('Chat 1'))
    fireEvent.click(screen.getByText('Chat 1'))
    await waitFor(() => screen.getByText('existing answer'))

    expect(screen.getByRole('textbox')).not.toBeDisabled()
  })

  it('re-enables the message input after deleting the conversation that was streaming', async () => {
    let capturedCallbacks: StreamCallbacks | undefined
    mockApi.listConversations.mockResolvedValue([
      { id: 'c1', title: 'Chat 1', lastMessage: '', updatedAt: '' },
    ])
    mockApi.getMessages.mockResolvedValue([{ role: 'assistant', content: 'existing answer' }])
    mockApi.sendMessage.mockImplementation(
      (_id: string, _msg: string, callbacks: StreamCallbacks) => {
        capturedCallbacks = callbacks
        return new Promise(() => {}) // simulates a request that never resolves (still streaming)
      }
    )
    mockApi.deleteConversation.mockResolvedValue(undefined)

    render(<ChatPage user={fakeUser} />)

    fireEvent.click(screen.getByRole('button', { name: 'Toggle menu' }))
    await waitFor(() => screen.getByText('Chat 1'))
    fireEvent.click(screen.getByText('Chat 1'))
    await waitFor(() => screen.getByText('existing answer'))

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'follow up' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await waitFor(() => expect(capturedCallbacks).toBeDefined())
    expect(screen.getByRole('textbox')).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Toggle menu' }))
    await waitFor(() => screen.getByRole('button', { name: 'Delete conversation' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete conversation' }))
    await waitFor(() => expect(screen.getByText('Start a conversation')).toBeInTheDocument())

    expect(screen.getByRole('textbox')).not.toBeDisabled()
  })

  it('does not leak chunks from an abandoned stream into the conversation switched to', async () => {
    let capturedCallbacks: StreamCallbacks | undefined
    mockApi.createConversation.mockImplementation((_msg: string, callbacks: StreamCallbacks) => {
      capturedCallbacks = callbacks
      return new Promise(() => {})
    })
    mockApi.listConversations.mockResolvedValue([
      { id: 'c1', title: 'Chat 1', lastMessage: '', updatedAt: '' },
    ])
    mockApi.getMessages.mockResolvedValue([{ role: 'assistant', content: 'existing answer' }])

    render(<ChatPage user={fakeUser} />)

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'new question' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await waitFor(() => expect(capturedCallbacks).toBeDefined())

    fireEvent.click(screen.getByRole('button', { name: 'Toggle menu' }))
    await waitFor(() => screen.getByText('Chat 1'))
    fireEvent.click(screen.getByText('Chat 1'))
    await waitFor(() => screen.getByText('existing answer'))

    act(() => capturedCallbacks!.onChunk('leaked text'))

    expect(screen.queryByText(/leaked text/)).not.toBeInTheDocument()
  })

  it('shows the finished answer after switching back to a conversation that kept streaming in the background', async () => {
    let capturedCallbacks: StreamCallbacks | undefined
    let c1FetchCount = 0
    mockApi.listConversations.mockResolvedValue([
      { id: 'c1', title: 'Chat 1', lastMessage: '', updatedAt: '' },
      { id: 'c2', title: 'Chat 2', lastMessage: '', updatedAt: '' },
    ])
    mockApi.getMessages.mockImplementation((id: string) => {
      if (id === 'c1') {
        c1FetchCount += 1
        if (c1FetchCount < 3) {
          return Promise.resolve([{ role: 'user', content: 'question' }])
        }
        return Promise.resolve([
          { role: 'user', content: 'question' },
          { role: 'user', content: 'follow up' },
          { role: 'assistant', content: 'the final answer' },
        ])
      }
      return Promise.resolve([{ role: 'assistant', content: 'chat 2 answer' }])
    })
    mockApi.sendMessage.mockImplementation(
      (_id: string, _msg: string, callbacks: StreamCallbacks) => {
        capturedCallbacks = callbacks
        return new Promise(() => {}) // simulates a request that never resolves (still streaming)
      }
    )

    render(<ChatPage user={fakeUser} />)

    fireEvent.click(screen.getByRole('button', { name: 'Toggle menu' }))
    await waitFor(() => screen.getByText('Chat 1'))
    fireEvent.click(screen.getByText('Chat 1'))
    await waitFor(() => screen.getByText('question'))

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'follow up' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await waitFor(() => expect(capturedCallbacks).toBeDefined())

    // switch away to a different conversation while c1 keeps streaming in the background
    fireEvent.click(screen.getByRole('button', { name: 'Toggle menu' }))
    await waitFor(() => screen.getByText('Chat 2'))
    fireEvent.click(screen.getByText('Chat 2'))
    await waitFor(() => screen.getByText('chat 2 answer'))

    // switch back to c1 before the background stream has finished
    fireEvent.click(screen.getByRole('button', { name: 'Toggle menu' }))
    await waitFor(() => screen.getByText('Chat 1'))
    fireEvent.click(screen.getByText('Chat 1'))
    await waitFor(() => screen.getByText('question'))
    expect(screen.queryByText('the final answer')).not.toBeInTheDocument()

    // the background stream finally completes and persists the reply
    await act(async () => {
      capturedCallbacks!.onDone()
    })

    await waitFor(() => expect(screen.getByText('the final answer')).toBeInTheDocument())
  })

  it('does not let a delayed post-stream refetch overwrite a conversation switched to afterward', async () => {
    let capturedCallbacks: StreamCallbacks | undefined
    let c1FetchCount = 0
    let resolveRefetch: (msgs: unknown[]) => void
    mockApi.listConversations.mockResolvedValue([
      { id: 'c1', title: 'Chat 1', lastMessage: '', updatedAt: '' },
      { id: 'c2', title: 'Chat 2', lastMessage: '', updatedAt: '' },
      { id: 'c3', title: 'Chat 3', lastMessage: '', updatedAt: '' },
    ])
    mockApi.getMessages.mockImplementation((id: string) => {
      if (id === 'c1') {
        c1FetchCount += 1
        // Calls 1 and 2 are the initial open and the switch-back-before-finish
        // fetch; both still miss the reply. Call 3 is onDone's own refetch —
        // held open so the test controls exactly when it resolves.
        if (c1FetchCount < 3) {
          return Promise.resolve([{ role: 'user', content: 'question' }])
        }
        return new Promise((resolve) => {
          resolveRefetch = resolve
        })
      }
      if (id === 'c2') return Promise.resolve([{ role: 'assistant', content: 'chat 2 answer' }])
      return Promise.resolve([{ role: 'assistant', content: 'chat 3 answer' }])
    })
    mockApi.sendMessage.mockImplementation(
      (_id: string, _msg: string, callbacks: StreamCallbacks) => {
        capturedCallbacks = callbacks
        return new Promise(() => {})
      }
    )

    render(<ChatPage user={fakeUser} />)

    fireEvent.click(screen.getByRole('button', { name: 'Toggle menu' }))
    await waitFor(() => screen.getByText('Chat 1'))
    fireEvent.click(screen.getByText('Chat 1'))
    await waitFor(() => screen.getByText('question'))

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'follow up' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await waitFor(() => expect(capturedCallbacks).toBeDefined())

    fireEvent.click(screen.getByRole('button', { name: 'Toggle menu' }))
    await waitFor(() => screen.getByText('Chat 2'))
    fireEvent.click(screen.getByText('Chat 2'))
    await waitFor(() => screen.getByText('chat 2 answer'))

    // switch back to c1 before the background stream has finished
    fireEvent.click(screen.getByRole('button', { name: 'Toggle menu' }))
    await waitFor(() => screen.getByText('Chat 1'))
    fireEvent.click(screen.getByText('Chat 1'))
    await waitFor(() => screen.getByText('question'))

    // the background stream finishes while c1 is still on screen — this
    // kicks off the completion refetch (held open by the mock above)
    await act(async () => {
      capturedCallbacks!.onDone()
    })

    // before that refetch resolves, the user moves on to a third conversation
    fireEvent.click(screen.getByRole('button', { name: 'Toggle menu' }))
    await waitFor(() => screen.getByText('Chat 3'))
    fireEvent.click(screen.getByText('Chat 3'))
    await waitFor(() => screen.getByText('chat 3 answer'))

    // only now does the stale refetch for c1 resolve — it must not clobber c3
    await act(async () => {
      resolveRefetch([
        { role: 'user', content: 'question' },
        { role: 'user', content: 'follow up' },
        { role: 'assistant', content: 'the final answer' },
      ])
    })

    expect(screen.getByText('chat 3 answer')).toBeInTheDocument()
    expect(screen.queryByText('the final answer')).not.toBeInTheDocument()
  })

  it('does not let a delayed post-stream refetch overwrite a new message sent in the same conversation', async () => {
    const capturedCallbacks: StreamCallbacks[] = []
    let c1FetchCount = 0
    let resolveRefetch: (msgs: unknown[]) => void
    mockApi.listConversations.mockResolvedValue([
      { id: 'c1', title: 'Chat 1', lastMessage: '', updatedAt: '' },
      { id: 'c2', title: 'Chat 2', lastMessage: '', updatedAt: '' },
    ])
    mockApi.getMessages.mockImplementation((id: string) => {
      if (id === 'c1') {
        c1FetchCount += 1
        if (c1FetchCount < 3) {
          return Promise.resolve([{ role: 'user', content: 'question' }])
        }
        return new Promise((resolve) => {
          resolveRefetch = resolve
        })
      }
      return Promise.resolve([{ role: 'assistant', content: 'chat 2 answer' }])
    })
    mockApi.sendMessage.mockImplementation(
      (_id: string, _msg: string, callbacks: StreamCallbacks) => {
        capturedCallbacks.push(callbacks)
        return new Promise(() => {})
      }
    )

    render(<ChatPage user={fakeUser} />)

    fireEvent.click(screen.getByRole('button', { name: 'Toggle menu' }))
    await waitFor(() => screen.getByText('Chat 1'))
    fireEvent.click(screen.getByText('Chat 1'))
    await waitFor(() => screen.getByText('question'))

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'follow up' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await waitFor(() => expect(capturedCallbacks).toHaveLength(1))

    fireEvent.click(screen.getByRole('button', { name: 'Toggle menu' }))
    await waitFor(() => screen.getByText('Chat 2'))
    fireEvent.click(screen.getByText('Chat 2'))
    await waitFor(() => screen.getByText('chat 2 answer'))

    // switch back to c1 before the background stream has finished
    fireEvent.click(screen.getByRole('button', { name: 'Toggle menu' }))
    await waitFor(() => screen.getByText('Chat 1'))
    fireEvent.click(screen.getByText('Chat 1'))
    await waitFor(() => screen.getByText('question'))

    // the background stream finishes while c1 is on screen — kicks off the
    // completion refetch (held open by the mock above)
    await act(async () => {
      capturedCallbacks[0].onDone()
    })

    // before that refetch resolves, the user sends ANOTHER message in the
    // same conversation (no navigation involved this time)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'second follow up' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await waitFor(() => expect(capturedCallbacks).toHaveLength(2))
    await waitFor(() => screen.getByText('second follow up'))

    // only now does the stale refetch resolve, with data that predates the new message
    await act(async () => {
      resolveRefetch([
        { role: 'user', content: 'question' },
        { role: 'user', content: 'follow up' },
        { role: 'assistant', content: 'the final answer' },
      ])
    })

    // the new message must survive, and new chunks must append to its
    // placeholder rather than being lost or attached to stale state
    expect(screen.getByText('second follow up')).toBeInTheDocument()
    act(() => capturedCallbacks[1].onChunk('reply to second'))
    await waitFor(() => expect(screen.getByText('reply to second')).toBeInTheDocument())
  })
})

describe('ChatPage compose button', () => {
  it('renders the compose button in the header', async () => {
    render(<ChatPage user={fakeUser} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'New chat' })).toBeInTheDocument())
  })

  it('clicking compose resets to the empty state', async () => {
    mockApi.listConversations.mockResolvedValue([
      { id: 'c1', title: 'Chat 1', lastMessage: '', updatedAt: '' },
    ])
    mockApi.getMessages.mockResolvedValue([
      { id: 'm1', role: 'user', content: 'hello' },
    ])

    render(<ChatPage user={fakeUser} />)

    // Open drawer and load a conversation
    fireEvent.click(screen.getByRole('button', { name: 'Toggle menu' }))
    await waitFor(() => screen.getByText('Chat 1'))
    fireEvent.click(screen.getByText('Chat 1'))
    await waitFor(() => screen.getByText('hello'))

    // Click compose — should reset to empty state
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }))
    await waitFor(() =>
      expect(screen.getByText('Start a conversation')).toBeInTheDocument()
    )
  })
})
