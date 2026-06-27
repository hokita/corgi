import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./firebase', () => ({
  auth: {
    currentUser: {
      getIdToken: vi.fn().mockResolvedValue('test-token'),
    },
  },
}))

import { api } from './api'

const mockFetch = vi.fn()
global.fetch = mockFetch

beforeEach(() => {
  vi.clearAllMocks()
})

function mockResponse(body: unknown, status = 200) {
  mockFetch.mockResolvedValue({
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
  })
}

function mockStreamResponse(events: object[]) {
  const encoder = new TextEncoder()
  const lines = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('')
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(lines))
      controller.close()
    },
  })
  mockFetch.mockResolvedValue({ ok: true, status: 200, body: stream })
}

describe('api.listConversations', () => {
  it('sends GET /api/conversations with Authorization header', async () => {
    mockResponse([{ id: 'c1', title: 'Test', lastMessage: 'hi', updatedAt: '' }])
    const result = await api.listConversations()
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/conversations'),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
      })
    )
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('c1')
  })
})

describe('api.createConversation', () => {
  it('calls onMeta, onChunk for each chunk, and onDone', async () => {
    mockStreamResponse([
      { type: 'meta', conversationId: 'c1', title: 'Hello' },
      { type: 'chunk', text: 'Hi ' },
      { type: 'chunk', text: 'there' },
      { type: 'done' },
    ])
    const onMeta = vi.fn()
    const onChunk = vi.fn()
    const onDone = vi.fn()
    const onError = vi.fn()
    await api.createConversation('Hello', { onMeta, onChunk, onDone, onError })
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/conversations'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ message: 'Hello' }),
      })
    )
    expect(onMeta).toHaveBeenCalledWith({ conversationId: 'c1', title: 'Hello' })
    expect(onChunk).toHaveBeenNthCalledWith(1, 'Hi ')
    expect(onChunk).toHaveBeenNthCalledWith(2, 'there')
    expect(onDone).toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
  })
})

describe('api.sendMessage', () => {
  it('calls onChunk for each chunk and onDone', async () => {
    mockStreamResponse([
      { type: 'chunk', text: 'Hello' },
      { type: 'chunk', text: ' world' },
      { type: 'done' },
    ])
    const onChunk = vi.fn()
    const onDone = vi.fn()
    const onError = vi.fn()
    await api.sendMessage('c1', 'Follow up', { onChunk, onDone, onError })
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/conversations/c1/messages'),
      expect.objectContaining({ method: 'POST' })
    )
    expect(onChunk).toHaveBeenNthCalledWith(1, 'Hello')
    expect(onChunk).toHaveBeenNthCalledWith(2, ' world')
    expect(onDone).toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
  })

  it('calls onError when error event received', async () => {
    mockStreamResponse([{ type: 'error', message: 'Internal server error' }])
    const onChunk = vi.fn()
    const onDone = vi.fn()
    const onError = vi.fn()
    await api.sendMessage('c1', 'Follow up', { onChunk, onDone, onError })
    expect(onError).toHaveBeenCalledWith('Internal server error')
    expect(onDone).not.toHaveBeenCalled()
  })

  it('calls onProgress for each progress event', async () => {
    mockStreamResponse([
      { type: 'progress', message: 'Analyzing your message...' },
      { type: 'chunk', text: 'Hello' },
      { type: 'progress', message: 'Done' },
      { type: 'done' },
    ])
    const onProgress = vi.fn()
    const onChunk = vi.fn()
    const onDone = vi.fn()
    const onError = vi.fn()
    await api.sendMessage('c1', 'hi', { onProgress, onChunk, onDone, onError })
    expect(onProgress).toHaveBeenNthCalledWith(1, 'Analyzing your message...')
    expect(onProgress).toHaveBeenNthCalledWith(2, 'Done')
  })
})

describe('api.deleteConversation', () => {
  it('sends DELETE /api/conversations/:id', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 204 })
    await api.deleteConversation('c1')
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/conversations/c1'),
      expect.objectContaining({ method: 'DELETE' })
    )
  })
})

