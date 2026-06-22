import { beforeEach, describe, it, expect, vi } from 'vitest'

const mockSendMessage = vi.fn()
const mockStartChat = vi.fn(() => ({ sendMessage: mockSendMessage }))
const mockGetGenerativeModel = vi.fn(() => ({ startChat: mockStartChat }))

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
    getGenerativeModel: mockGetGenerativeModel,
  })),
}))

import { GeminiProvider } from './GeminiProvider'
import { OverloadedError } from '../errors'

describe('GeminiProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the response text from Gemini', async () => {
    mockSendMessage.mockResolvedValue({
      response: { text: () => 'Hello from Gemini' },
    })
    const provider = new GeminiProvider('fake-key')
    const result = await provider.chat([], 'Hi')
    expect(result).toBe('Hello from Gemini')
  })

  it('throws OverloadedError when Gemini returns status 503', async () => {
    const err = Object.assign(new Error('Service Unavailable'), { status: 503 })
    mockSendMessage.mockRejectedValue(err)
    const provider = new GeminiProvider('fake-key')
    await expect(provider.chat([], 'Hi')).rejects.toThrow(OverloadedError)
  })

  it('throws OverloadedError when Gemini error message contains "overloaded"', async () => {
    mockSendMessage.mockRejectedValue(new Error('The model is overloaded. Please try again later.'))
    const provider = new GeminiProvider('fake-key')
    await expect(provider.chat([], 'Hi')).rejects.toThrow(OverloadedError)
  })

  it('rethrows non-overloaded errors unchanged', async () => {
    const err = new Error('Unknown error')
    mockSendMessage.mockRejectedValue(err)
    const provider = new GeminiProvider('fake-key')
    await expect(provider.chat([], 'Hi')).rejects.toBe(err)
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
