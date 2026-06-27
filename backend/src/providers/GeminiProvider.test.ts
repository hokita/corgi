import { beforeEach, describe, it, expect, vi } from 'vitest'
import type { StreamItem } from './AIProvider'

const mockSendMessageStream = vi.fn()
const mockGenerateContentStream = vi.fn()
const mockStartChat = vi.fn(() => ({ sendMessageStream: mockSendMessageStream }))
const mockGetGenerativeModel = vi.fn(() => ({
  startChat: mockStartChat,
  generateContentStream: mockGenerateContentStream,
}))

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
    getGenerativeModel: mockGetGenerativeModel,
  })),
  SchemaType: {
    OBJECT: 'object',
    ARRAY: 'array',
    STRING: 'string',
  },
}))

import { GeminiProvider } from './GeminiProvider'

async function collectStream(stream: AsyncIterable<StreamItem>): Promise<StreamItem[]> {
  const items: StreamItem[] = []
  for await (const item of stream) items.push(item)
  return items
}

describe('GeminiProvider', () => {
  beforeEach(() => vi.clearAllMocks())

  it('yields text chunks from Gemini stream', async () => {
    async function* fakeStream() {
      yield { text: () => 'Hello', candidates: undefined }
      yield { text: () => ' world', candidates: undefined }
    }
    mockSendMessageStream.mockResolvedValue({ stream: fakeStream() })
    const provider = new GeminiProvider('fake-key')
    const items = await collectStream(provider.chatStream([], 'Hi'))
    expect(items).toEqual(['Hello', ' world'])
  })

  it('maps assistant role to "model" when building history', async () => {
    async function* fakeStream() {
      yield { text: () => 'reply', candidates: undefined }
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
    expect(mockStartChat).toHaveBeenCalledWith(
      expect.objectContaining({
        history: [
          { role: 'user', parts: [{ text: 'first message' }] },
          { role: 'model', parts: [{ text: 'first reply' }] },
        ],
      })
    )
  })

  it('skips empty text chunks', async () => {
    async function* fakeStream() {
      yield { text: () => 'Hello', candidates: undefined }
      yield { text: () => '', candidates: undefined }
      yield { text: () => ' world', candidates: undefined }
    }
    mockSendMessageStream.mockResolvedValue({ stream: fakeStream() })
    const provider = new GeminiProvider('fake-key')
    const items = await collectStream(provider.chatStream([], 'Hi'))
    expect(items).toEqual(['Hello', ' world'])
  })

  it('yields suggestions item when Gemini calls suggest_options', async () => {
    async function* fakeStream() {
      yield { text: () => 'Here are your options.', candidates: undefined }
      yield {
        text: () => '',
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: {
                    name: 'suggest_options',
                    args: { items: ['Yes', 'No', 'Maybe'] },
                  },
                },
              ],
            },
          },
        ],
      }
    }
    mockSendMessageStream.mockResolvedValue({ stream: fakeStream() })
    const provider = new GeminiProvider('fake-key')
    const items = await collectStream(provider.chatStream([], 'Give me options'))
    expect(items).toEqual([
      'Here are your options.',
      { type: 'suggestions', items: ['Yes', 'No', 'Maybe'] },
    ])
  })

  it('includes googleSearch tool when googleSearch option is true', async () => {
    async function* fakeStream() {
      yield { text: () => 'result', candidates: undefined }
    }
    mockSendMessageStream.mockResolvedValue({ stream: fakeStream() })
    const provider = new GeminiProvider('fake-key', { googleSearch: true })
    await collectStream(provider.chatStream([], 'search something'))
    expect(mockStartChat).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: expect.arrayContaining([{ googleSearch: {} }]),
      })
    )
  })

  it('excludes googleSearch tool when googleSearch option is false', async () => {
    async function* fakeStream() {
      yield { text: () => 'result', candidates: undefined }
    }
    mockSendMessageStream.mockResolvedValue({ stream: fakeStream() })
    const provider = new GeminiProvider('fake-key', { googleSearch: false })
    await collectStream(provider.chatStream([], 'search something'))
    expect(mockStartChat).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: expect.not.arrayContaining([{ googleSearch: {} }]),
      })
    )
  })

  it('excludes googleSearch tool by default', async () => {
    async function* fakeStream() {
      yield { text: () => 'result', candidates: undefined }
    }
    mockSendMessageStream.mockResolvedValue({ stream: fakeStream() })
    const provider = new GeminiProvider('fake-key')
    await collectStream(provider.chatStream([], 'search something'))
    expect(mockStartChat).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: expect.not.arrayContaining([{ googleSearch: {} }]),
      })
    )
  })

  it('ignores unknown function calls', async () => {
    async function* fakeStream() {
      yield { text: () => 'Done.', candidates: undefined }
      yield {
        text: () => '',
        candidates: [
          {
            content: {
              parts: [{ functionCall: { name: 'unknown_tool', args: {} } }],
            },
          },
        ],
      }
    }
    mockSendMessageStream.mockResolvedValue({ stream: fakeStream() })
    const provider = new GeminiProvider('fake-key')
    const items = await collectStream(provider.chatStream([], 'Hi'))
    expect(items).toEqual(['Done.'])
  })

  it('sends function result back via generateContentStream to preserve thought_signature', async () => {
    const mistakeData = {
      originalText: 'I go to school yesterday.',
      correctedText: 'I went to school yesterday.',
      category: 'grammar',
      severity: 'medium',
      patternKey: 'past_tense_for_past_action',
    }
    const rawFunctionCallPart = {
      functionCall: { name: 'save_english_mistake', args: mistakeData, thought_signature: 'abc123' },
    }
    async function* firstStream() {
      yield {
        text: () => '',
        candidates: [{ content: { parts: [rawFunctionCallPart] } }],
      }
    }
    async function* followUpStream() {
      yield { text: () => 'Great effort! Keep practicing.', candidates: undefined }
    }
    mockSendMessageStream.mockResolvedValueOnce({ stream: firstStream() })
    mockGenerateContentStream.mockResolvedValueOnce({ stream: followUpStream() })
    const provider = new GeminiProvider('fake-key')
    const items = await collectStream(provider.chatStream([], 'I go to school yesterday.'))
    expect(items).toEqual([
      { type: 'save_english_mistake', data: mistakeData },
      'Great effort! Keep practicing.',
    ])
    // follow-up must use generateContentStream (not sendMessageStream) so that
    // raw model parts (including thought_signature) are preserved in the history
    expect(mockSendMessageStream).toHaveBeenCalledTimes(1)
    expect(mockGenerateContentStream).toHaveBeenCalledTimes(1)
    type ContentTurn = { role: string; parts: unknown[] }
    const followUpArg = mockGenerateContentStream.mock.calls[0][0] as { contents: ContentTurn[] }
    const modelTurn = followUpArg.contents.find((c) => c.role === 'model')
    expect(modelTurn.parts[0]).toMatchObject({
      functionCall: expect.objectContaining({ thought_signature: 'abc123' }),
    })
  })

  it('yields save_english_mistake item when Gemini calls save_english_mistake', async () => {
    const mistakeData = {
      originalText: 'I resolved the issue with downgrade of Node version.',
      correctedText: 'I resolved the issue by downgrading the Node version.',
      category: 'grammar',
      severity: 'medium',
      patternKey: 'by_gerund_for_method',
    }
    async function* fakeStream() {
      yield { text: () => 'Great effort!', candidates: undefined }
      yield {
        text: () => '',
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: {
                    name: 'save_english_mistake',
                    args: mistakeData,
                  },
                },
              ],
            },
          },
        ],
      }
    }
    mockSendMessageStream.mockResolvedValue({ stream: fakeStream() })
    const provider = new GeminiProvider('fake-key')
    const items = await collectStream(
      provider.chatStream([], 'I resolved the issue with downgrade of Node version.')
    )
    expect(items).toEqual([
      'Great effort!',
      { type: 'save_english_mistake', data: mistakeData },
    ])
  })

})
