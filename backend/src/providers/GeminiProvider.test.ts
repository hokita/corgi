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

  it('includes current JST datetime in system instruction', async () => {
    vi.useFakeTimers()
    // 2026-06-27T10:00:00Z = 2026-06-27T19:00:00+09:00 in JST
    vi.setSystemTime(new Date('2026-06-27T10:00:00.000Z'))

    async function* fakeStream() {
      yield { text: () => 'reply', candidates: undefined }
    }
    mockSendMessageStream.mockResolvedValue({ stream: fakeStream() })

    const provider = new GeminiProvider('fake-key')
    await collectStream(provider.chatStream([], 'Hi', noopExecutor))

    expect(mockGetGenerativeModel).toHaveBeenCalledWith(
      expect.objectContaining({
        systemInstruction: expect.stringContaining('2026-06-27 19:00:00 JST'),
      })
    )

    vi.useRealTimers()
  })

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
      type: 'mistake',
    }
    const rawFunctionCallPart = {
      functionCall: {
        name: 'save_english_mistake',
        args: mistakeData,
        thought_signature: 'abc123',
      },
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
    const items = await collectStream(
      provider.chatStream([], 'I go to school yesterday.', executeFn)
    )

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

  it('forwards type: "suggestion" to executeFn unchanged for naturalness-only saves', async () => {
    const suggestionData = {
      originalText: 'I am looking forward to see you.',
      correctedText: 'I am looking forward to seeing you.',
      category: 'phrasing',
      severity: 'low',
      patternKey: 'look_forward_to_gerund',
      type: 'suggestion',
    }
    const rawFunctionCallPart = {
      functionCall: { name: 'save_english_mistake', args: suggestionData },
    }
    async function* firstStream() {
      yield {
        text: () => '',
        candidates: [{ content: { parts: [rawFunctionCallPart] } }],
      }
    }
    async function* followUpStream() {
      yield { text: () => 'Sounds great! (More natural: ... → ...)', candidates: undefined }
    }
    mockSendMessageStream.mockResolvedValueOnce({ stream: firstStream() })
    mockGenerateContentStream.mockResolvedValueOnce({ stream: followUpStream() })

    const executeFn: FunctionExecutor = vi.fn().mockResolvedValue({ result: 'saved' })
    const provider = new GeminiProvider('fake-key')
    await collectStream(provider.chatStream([], 'I am looking forward to see you.', executeFn))

    expect(executeFn).toHaveBeenCalledWith('save_english_mistake', suggestionData)
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
      expect.objectContaining({
        functionResponse: expect.objectContaining({ name: 'get_english_mistakes' }),
      })
    )
  })

  it('sends a functionResponse for suggest_options when it accompanies a tool call', async () => {
    // Regression: the HN briefing turn is function-call-only and often includes
    // suggest_options alongside the tool call. The follow-up request replays the
    // model turn verbatim, so every functionCall in it needs a functionResponse
    // or the API rejects the request.
    async function* firstStream() {
      yield {
        text: () => '',
        candidates: [
          {
            content: {
              parts: [
                { functionCall: { name: 'get_hacker_news_briefing', args: {} } },
                { functionCall: { name: 'suggest_options', args: { items: ['A', 'B'] } } },
              ],
            },
          },
        ],
      }
    }
    async function* followUpStream() {
      yield { text: () => '# ☕ Morning Coffee Briefing', candidates: undefined }
    }
    mockSendMessageStream.mockResolvedValueOnce({ stream: firstStream() })
    mockGenerateContentStream.mockResolvedValueOnce({ stream: followUpStream() })

    const executeFn: FunctionExecutor = vi.fn().mockResolvedValue({ stories: [] })
    const provider = new GeminiProvider('fake-key')
    const items = await collectStream(provider.chatStream([], 'Morning briefing', executeFn))

    expect(executeFn).toHaveBeenCalledTimes(1)
    expect(executeFn).toHaveBeenCalledWith('get_hacker_news_briefing', {})
    expect(items).toEqual([
      '# ☕ Morning Coffee Briefing',
      { type: 'suggestions', items: ['A', 'B'] },
    ])

    type ContentTurn = { role: string; parts: unknown[] }
    const followUpArg = mockGenerateContentStream.mock.calls[0][0] as { contents: ContentTurn[] }
    const responseTurn = followUpArg.contents[followUpArg.contents.length - 1]
    expect(responseTurn.parts).toEqual([
      {
        functionResponse: {
          name: 'get_hacker_news_briefing',
          response: { stories: [] },
        },
      },
      {
        functionResponse: {
          name: 'suggest_options',
          response: { result: 'displayed' },
        },
      },
      { text: expect.stringContaining('suggest_options') },
    ])
  })

  it('appends a suggest_options reminder text part after the function responses', async () => {
    async function* firstStream() {
      yield {
        text: () => '',
        candidates: [
          {
            content: {
              parts: [{ functionCall: { name: 'get_hacker_news_briefing', args: {} } }],
            },
          },
        ],
      }
    }
    async function* followUpStream() {
      yield { text: () => 'Briefing text', candidates: undefined }
    }
    mockSendMessageStream.mockResolvedValueOnce({ stream: firstStream() })
    mockGenerateContentStream.mockResolvedValueOnce({ stream: followUpStream() })

    const executeFn: FunctionExecutor = vi.fn().mockResolvedValue({ stories: [] })
    const provider = new GeminiProvider('fake-key')
    await collectStream(provider.chatStream([], 'Morning briefing', executeFn))

    type ContentTurn = { role: string; parts: unknown[] }
    const followUpArg = mockGenerateContentStream.mock.calls[0][0] as { contents: ContentTurn[] }
    const responseTurn = followUpArg.contents[followUpArg.contents.length - 1]
    expect(responseTurn.role).toBe('user')
    expect(responseTurn.parts[responseTurn.parts.length - 1]).toEqual({
      text: expect.stringContaining('end your turn by calling the `suggest_options` function'),
    })
  })

  it('yields suggestions when suggest_options is called in the follow-up stream', async () => {
    async function* firstStream() {
      yield {
        text: () => '',
        candidates: [
          {
            content: {
              parts: [{ functionCall: { name: 'get_hacker_news_briefing', args: {} } }],
            },
          },
        ],
      }
    }
    async function* followUpStream() {
      yield { text: () => '# ☕ Morning Coffee Briefing', candidates: undefined }
      yield {
        text: () => '',
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: {
                    name: 'suggest_options',
                    args: { items: ['More on: Rust async', 'More on: YC stats'] },
                  },
                },
              ],
            },
          },
        ],
      }
    }
    mockSendMessageStream.mockResolvedValueOnce({ stream: firstStream() })
    mockGenerateContentStream.mockResolvedValueOnce({ stream: followUpStream() })

    const executeFn: FunctionExecutor = vi.fn().mockResolvedValue({ stories: [] })
    const provider = new GeminiProvider('fake-key')
    const items = await collectStream(provider.chatStream([], 'Morning briefing', executeFn))

    expect(items).toEqual([
      '# ☕ Morning Coffee Briefing',
      { type: 'suggestions', items: ['More on: Rust async', 'More on: YC stats'] },
    ])
  })

  it('does not make a follow-up call when only suggest_options was called', async () => {
    async function* fakeStream() {
      yield {
        text: () => '',
        candidates: [
          {
            content: {
              parts: [{ functionCall: { name: 'suggest_options', args: { items: ['A', 'B'] } } }],
            },
          },
        ],
      }
    }
    mockSendMessageStream.mockResolvedValueOnce({ stream: fakeStream() })
    const provider = new GeminiProvider('fake-key')
    const items = await collectStream(provider.chatStream([], 'Hi', noopExecutor))
    expect(mockGenerateContentStream).not.toHaveBeenCalled()
    expect(items).toEqual([{ type: 'suggestions', items: ['A', 'B'] }])
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
})
