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

beforeEach(() => vi.clearAllMocks())

function mockResponse(body: unknown, status = 200) {
  mockFetch.mockResolvedValue({
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
  })
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
  it('sends POST /api/conversations with message body', async () => {
    mockResponse({ conversationId: 'c1', title: 'Hi', assistantMessage: 'Hello' })
    const result = await api.createConversation('Hi')
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/conversations'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ message: 'Hi' }),
      })
    )
    expect(result.conversationId).toBe('c1')
  })
})

describe('api.sendMessage', () => {
  it('sends POST /api/conversations/:id/messages', async () => {
    mockResponse({ assistantMessage: 'reply' })
    const result = await api.sendMessage('c1', 'Follow up')
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/conversations/c1/messages'),
      expect.objectContaining({ method: 'POST' })
    )
    expect(result.assistantMessage).toBe('reply')
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
