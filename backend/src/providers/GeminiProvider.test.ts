import { describe, it, expect, vi } from 'vitest'

const mockSendMessage = vi.fn()
const mockStartChat = vi.fn(() => ({ sendMessage: mockSendMessage }))
const mockGetGenerativeModel = vi.fn(() => ({ startChat: mockStartChat }))

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
    getGenerativeModel: mockGetGenerativeModel,
  })),
}))

import { GeminiProvider } from './GeminiProvider'

describe('GeminiProvider', () => {
  it('returns the response text from Gemini', async () => {
    mockSendMessage.mockResolvedValue({
      response: { text: () => 'Hello from Gemini' },
    })
    const provider = new GeminiProvider('fake-key')
    const result = await provider.chat([], 'Hi')
    expect(result).toBe('Hello from Gemini')
  })

  it('maps assistant role to "model" when building history', async () => {
    mockSendMessage.mockResolvedValue({ response: { text: () => 'reply' } })
    const provider = new GeminiProvider('fake-key')
    await provider.chat(
      [
        { role: 'user', content: 'first message' },
        { role: 'assistant', content: 'first reply' },
      ],
      'second message'
    )
    expect(mockStartChat).toHaveBeenCalledWith({
      history: [
        { role: 'user', parts: [{ text: 'first message' }] },
        { role: 'model', parts: [{ text: 'first reply' }] },
      ],
    })
  })
})
