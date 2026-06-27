import { beforeEach, describe, it, expect, vi } from 'vitest'
import type { StreamItem, FunctionExecutor } from './AIProvider'

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

const noopExecutor: FunctionExecutor = vi.fn().mockResolvedValue({})

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
    const items = await collectStream(provider.chatStream([], 'Hi', noopExecutor))
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
        'second message',
        noopExecutor
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
    const items = await collectStream(provider.chatStream([], 'Hi', noopExecutor))
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
    const items = await collectStream(provider.chatStream([], 'Give me options', noopExecutor))
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
    await collectStream(provider.chatStream([], 'search something', noopExecutor))
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
    await collectStream(provider.chatStream([], 'search something', noopExecutor))
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
    await collectStream(provider.chatStream([], 'search something', noopExecutor))
    expect(mockStartChat).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: expect.not.arrayContaining([{ googleSearch: {} }]),
      })
    )
  })

  it('calls executeFn for save_english_mistake and uses result in follow-up', async () => {
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

    const executeFn: FunctionExecutor = vi.fn().mockResolvedValue({ result: 'saved' })
    const provider = new GeminiProvider('fake-key')
    const items = await collectStream(provider.chatStream([], 'I go to school yesterday.', executeFn))

    expect(executeFn).toHaveBeenCalledWith('save_english_mistake', mistakeData)
    expect(items).toEqual(['Great effort! Keep practicing.'])
    expect(mockSendMessageStream).toHaveBeenCalledTimes(1)
    expect(mockGenerateContentStream).toHaveBeenCalledTimes(1)
    type ContentTurn = { role: string; parts: unknown[] }
    const followUpArg = mockGenerateContentStream.mock.calls[0][0] as { contents: ContentTurn[] }
    const modelTurn = followUpArg.contents.find((c) => c.role === 'model')
    expect(modelTurn!.parts[0]).toMatchObject({
      functionCall: expect.objectContaining({ thought_signature: 'abc123' }),
    })
  })

  it('calls executeFn for get_english_mistakes and uses result in follow-up', async () => {
    const queryArgs = { startDate: '2026-06-27', category: 'grammar' }
    const mistakes = [{ id: 'm1', originalText: 'I go', correctedText: 'I went' }]
    async function* firstStream() {
      yield {
        text: () => '',
        candidates: [
          {
            content: {
              parts: [{ functionCall: { name: 'get_english_mistakes', args: queryArgs } }],
            },
          },
        ],
      }
    }
    async function* followUpStream() {
      yield { text: () => 'Here are your mistakes for today.', candidates: undefined }
    }
    mockSendMessageStream.mockResolvedValueOnce({ stream: firstStream() })
    mockGenerateContentStream.mockResolvedValueOnce({ stream: followUpStream() })

    const executeFn: FunctionExecutor = vi.fn().mockResolvedValue({ mistakes })
    const provider = new GeminiProvider('fake-key')
    const items = await collectStream(provider.chatStream([], 'Show my mistakes', executeFn))

    expect(executeFn).toHaveBeenCalledWith('get_english_mistakes', queryArgs)
    expect(items).toEqual(['Here are your mistakes for today.'])
    type ContentTurn = { role: string; parts: unknown[] }
    const followUpArg = mockGenerateContentStream.mock.calls[0][0] as { contents: ContentTurn[] }
    const allParts = followUpArg.contents.flatMap((c) => c.parts)
    expect(allParts).toContainEqual(
      expect.objectContaining({ functionResponse: expect.objectContaining({ name: 'get_english_mistakes' }) })
    )
  })

  it('calls executeFn for unknown function calls', async () => {
    async function* fakeStream() {
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
    async function* followUpStream() {
      yield { text: () => 'Done.', candidates: undefined }
    }
    mockSendMessageStream.mockResolvedValueOnce({ stream: fakeStream() })
    mockGenerateContentStream.mockResolvedValueOnce({ stream: followUpStream() })

    const executeFn: FunctionExecutor = vi.fn().mockResolvedValue({ error: 'unknown function' })
    const provider = new GeminiProvider('fake-key')
    await collectStream(provider.chatStream([], 'Hi', executeFn))

    expect(executeFn).toHaveBeenCalledWith('unknown_tool', {})
  })

  it('executes non-suggest_options function calls in follow-up stream and yields text', async () => {
    const mistakeData = { originalText: 'I go', correctedText: 'I went', category: 'grammar', severity: 'low', patternKey: 'past_tense' }
    async function* firstStream() {
      yield {
        text: () => '',
        candidates: [{ content: { parts: [{ functionCall: { name: 'save_english_mistake', args: mistakeData } }] } }],
      }
    }
    async function* followUpStream() {
      // Follow-up calls save_english_mistake again, then produces text.
      // hasText becomes true after the text chunk, so the loop exits even though
      // pendingFunctionResponses has an entry from this round.
      yield {
        text: () => '',
        candidates: [{ content: { parts: [{ functionCall: { name: 'save_english_mistake', args: mistakeData } }] } }],
      }
      yield { text: () => 'Great job!', candidates: undefined }
    }
    mockSendMessageStream.mockResolvedValueOnce({ stream: firstStream() })
    mockGenerateContentStream.mockResolvedValueOnce({ stream: followUpStream() })

    const executeFn: FunctionExecutor = vi.fn().mockResolvedValue({ result: 'saved' })
    const provider = new GeminiProvider('fake-key')
    const items = await collectStream(provider.chatStream([], 'I go to school yesterday.', executeFn))

    expect(executeFn).toHaveBeenCalledTimes(2)
    expect(executeFn).toHaveBeenCalledWith('save_english_mistake', mistakeData)
    expect(items).toContain('Great job!')
  })

  it('stops after MAX_FOLLOW_UP_ROUNDS (5) if the model never produces text', async () => {
    const fnCall = { name: 'save_english_mistake', args: { originalText: 'x', correctedText: 'y', category: 'grammar', severity: 'low', patternKey: 'p' } }
    async function* fnOnlyStream() {
      yield {
        text: () => '',
        candidates: [{ content: { parts: [{ functionCall: fnCall }] } }],
      }
    }
    mockSendMessageStream.mockResolvedValueOnce({ stream: fnOnlyStream() })
    // Each of the 5 follow-up rounds also returns only a function call, never text
    for (let i = 0; i < 5; i++) {
      mockGenerateContentStream.mockResolvedValueOnce({ stream: fnOnlyStream() })
    }

    const executeFn: FunctionExecutor = vi.fn().mockResolvedValue({ result: 'saved' })
    const provider = new GeminiProvider('fake-key')
    const items = await collectStream(provider.chatStream([], 'Hi', executeFn))

    // 1 from first stream + 5 from follow-up rounds = 6 total
    expect(executeFn).toHaveBeenCalledTimes(6)
    // generateContentStream called exactly 5 times (MAX_FOLLOW_UP_ROUNDS)
    expect(mockGenerateContentStream).toHaveBeenCalledTimes(5)
    // No text was ever produced — stream ends empty (no crash)
    expect(items).toEqual([])
  })
})
