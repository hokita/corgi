import { beforeEach, describe, it, expect, vi } from 'vitest'

const mockSendMessageStream = vi.fn()
const mockStartChat = vi.fn(() => ({ sendMessageStream: mockSendMessageStream }))
const mockGetGenerativeModel = vi.fn(() => ({ startChat: mockStartChat }))

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
    getGenerativeModel: mockGetGenerativeModel,
  })),
}))

import { GeminiProvider } from './GeminiProvider'

async function collectStream(stream: AsyncIterable<string>): Promise<string[]> {
  const chunks: string[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

describe('GeminiProvider', () => {
  beforeEach(() => vi.clearAllMocks())

  it('yields text chunks from Gemini stream', async () => {
    async function* fakeStream() {
      yield { text: () => 'Hello' }
      yield { text: () => ' world' }
    }
    mockSendMessageStream.mockResolvedValue({ stream: fakeStream() })
    const provider = new GeminiProvider('fake-key')
    const chunks = await collectStream(provider.chatStream([], 'Hi'))
    expect(chunks).toEqual(['Hello', ' world'])
  })

  it('maps assistant role to "model" when building history', async () => {
    async function* fakeStream() {
      yield { text: () => 'reply' }
    }
    mockSendMessageStream.mockResolvedValue({ stream: fakeStream() })
    const provider = new GeminiProvider('fake-key')
    await collectStream(
      provider.chatStream(
        [
          { role: 'user', content: 'first message' },
          { role: 'assistant', content: 'first reply' },
        ],
        'second message'
      )
    )
    expect(mockStartChat).toHaveBeenCalledWith({
      history: [
        { role: 'user', parts: [{ text: 'first message' }] },
        { role: 'model', parts: [{ text: 'first reply' }] },
      ],
    })
  })

  it('skips empty text chunks', async () => {
    async function* fakeStream() {
      yield { text: () => 'Hello' }
      yield { text: () => '' }
      yield { text: () => ' world' }
    }
    mockSendMessageStream.mockResolvedValue({ stream: fakeStream() })
    const provider = new GeminiProvider('fake-key')
    const chunks = await collectStream(provider.chatStream([], 'Hi'))
    expect(chunks).toEqual(['Hello', ' world'])
  })
})
