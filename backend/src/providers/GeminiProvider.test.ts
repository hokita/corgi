import { beforeEach, describe, it, expect, vi } from 'vitest'
import type { StreamItem, FunctionExecutor } from './AIProvider'

const mockSendMessageStream = vi.fn()
const mockGenerateContentStream = vi.fn()
// Used by the separate flash-lite suggestion call (model.generateContent).
const mockGenerateContent = vi.fn()
const mockStartChat = vi.fn(() => ({ sendMessageStream: mockSendMessageStream }))
const mockGetGenerativeModel = vi.fn(() => ({
  startChat: mockStartChat,
  generateContentStream: mockGenerateContentStream,
  generateContent: mockGenerateContent,
}))

// Builds a generateContent result the way the suggestion model returns it:
// JSON text with a `suggestions` array.
function suggestionResult(items: string[]) {
  return {
    response: {
      text: () => JSON.stringify({ suggestions: items }),
      usageMetadata: {},
    },
  }
}

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

import { GeminiProvider, TRUNCATION_NOTICE, REPETITION_NOTICE } from './GeminiProvider'

const noopExecutor: FunctionExecutor = vi.fn().mockResolvedValue({})

async function collectStream(stream: AsyncIterable<StreamItem>): Promise<StreamItem[]> {
  const items: StreamItem[] = []
  for await (const item of stream) items.push(item)
  return items
}

function textChunk(text: string) {
  return { candidates: [{ content: { parts: [{ text }] } }] }
}

describe('GeminiProvider', () => {
  beforeEach(() => vi.clearAllMocks())

  it('includes current JST datetime in system instruction', async () => {
    vi.useFakeTimers()
    // 2026-06-27T10:00:00Z = 2026-06-27T19:00:00+09:00 in JST
    vi.setSystemTime(new Date('2026-06-27T10:00:00.000Z'))

    async function* fakeStream() {
      yield textChunk('reply')
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

  it('passes maxOutputTokens in generationConfig', async () => {
    async function* fakeStream() {
      yield textChunk('reply')
    }
    mockSendMessageStream.mockResolvedValue({ stream: fakeStream() })
    const provider = new GeminiProvider('fake-key')
    await collectStream(provider.chatStream([], 'Hi', noopExecutor))
    expect(mockGetGenerativeModel).toHaveBeenCalledWith(
      expect.objectContaining({
        generationConfig: expect.objectContaining({ maxOutputTokens: 15000 }),
      })
    )
  })

  it('does not register suggest_options as a chat tool', async () => {
    async function* fakeStream() {
      yield textChunk('reply')
    }
    mockSendMessageStream.mockResolvedValue({ stream: fakeStream() })
    const provider = new GeminiProvider('fake-key')
    await collectStream(provider.chatStream([], 'Hi', noopExecutor))
    const startChatArg = mockStartChat.mock.calls[0][0] as {
      tools: { functionDeclarations?: { name: string }[] }[]
    }
    const declaredNames = startChatArg.tools.flatMap(
      (t) => t.functionDeclarations?.map((d) => d.name) ?? []
    )
    expect(declaredNames).not.toContain('suggest_options')
  })

  it('yields text chunks from Gemini stream', async () => {
    async function* fakeStream() {
      yield textChunk('Hello')
      yield textChunk(' world')
    }
    mockSendMessageStream.mockResolvedValue({ stream: fakeStream() })
    const provider = new GeminiProvider('fake-key')
    const items = await collectStream(provider.chatStream([], 'Hi', noopExecutor))
    expect(items).toEqual(['Hello', ' world'])
  })

  it('maps assistant role to "model" when building history', async () => {
    async function* fakeStream() {
      yield textChunk('reply')
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
      yield textChunk('Hello')
      yield textChunk('')
      yield textChunk(' world')
    }
    mockSendMessageStream.mockResolvedValue({ stream: fakeStream() })
    const provider = new GeminiProvider('fake-key')
    const items = await collectStream(provider.chatStream([], 'Hi', noopExecutor))
    expect(items).toEqual(['Hello', ' world'])
  })

  it('does not stream thought parts as visible text', async () => {
    async function* fakeStream() {
      yield {
        candidates: [
          {
            content: {
              parts: [
                { text: "Let's plan the reply step by step...", thought: true },
                { text: 'answer' },
              ],
            },
          },
        ],
      }
    }
    mockSendMessageStream.mockResolvedValue({ stream: fakeStream() })
    const provider = new GeminiProvider('fake-key')
    const items = await collectStream(provider.chatStream([], 'Hi', noopExecutor))
    expect(items).toEqual(['answer'])
  })

  it('throws when a chunk reports a blocked finishReason', async () => {
    // chunk.text() used to throw on SAFETY/RECITATION/LANGUAGE; visibleText()
    // must not turn those into a silently truncated successful stream.
    async function* fakeStream() {
      yield textChunk('The story begins')
      yield { candidates: [{ finishReason: 'RECITATION', content: { parts: [] } }] }
    }
    mockSendMessageStream.mockResolvedValue({ stream: fakeStream() })
    const provider = new GeminiProvider('fake-key')
    await expect(collectStream(provider.chatStream([], 'Hi', noopExecutor))).rejects.toThrow(
      'finishReason RECITATION'
    )
  })

  it('throws when prompt feedback reports a block', async () => {
    async function* fakeStream() {
      yield { candidates: undefined, promptFeedback: { blockReason: 'SAFETY' } }
    }
    mockSendMessageStream.mockResolvedValue({ stream: fakeStream() })
    const provider = new GeminiProvider('fake-key')
    await expect(collectStream(provider.chatStream([], 'Hi', noopExecutor))).rejects.toThrow(
      'blocked: SAFETY'
    )
  })

  it('does not throw on benign finish reasons', async () => {
    async function* fakeStream() {
      yield { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'done' }] } }] }
    }
    mockSendMessageStream.mockResolvedValue({ stream: fakeStream() })
    const provider = new GeminiProvider('fake-key')
    const items = await collectStream(provider.chatStream([], 'Hi', noopExecutor))
    expect(items).toEqual(['done'])
  })

  it('appends a truncation notice when the stream hits MAX_TOKENS', async () => {
    // Regression: MAX_TOKENS is not a blocked finishReason, so the cut-off
    // reply used to be persisted silently as if it were complete (the HN
    // briefing rendering a single story).
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    async function* fakeStream() {
      yield textChunk('# ☕ Morning Coffee Briefing\n\nFirst story')
      yield { candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [] } }] }
    }
    mockSendMessageStream.mockResolvedValue({ stream: fakeStream() })
    const provider = new GeminiProvider('fake-key')
    const items = await collectStream(provider.chatStream([], 'Morning briefing', noopExecutor))
    expect(items).toEqual(['# ☕ Morning Coffee Briefing\n\nFirst story', TRUNCATION_NOTICE])
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('appends a truncation notice when the follow-up stream hits MAX_TOKENS', async () => {
    async function* firstStream() {
      yield {
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
      yield {
        candidates: [
          { finishReason: 'MAX_TOKENS', content: { parts: [{ text: 'Partial briefing' }] } },
        ],
      }
    }
    mockSendMessageStream.mockResolvedValueOnce({ stream: firstStream() })
    mockGenerateContentStream.mockResolvedValueOnce({ stream: followUpStream() })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const executeFn: FunctionExecutor = vi.fn().mockResolvedValue({ stories: [] })
    const provider = new GeminiProvider('fake-key')
    const items = await collectStream(provider.chatStream([], 'Morning briefing', executeFn))

    expect(items).toEqual(['Partial briefing', TRUNCATION_NOTICE])
    warnSpy.mockRestore()
  })

  it('still makes the follow-up call when a function-call-only turn hits MAX_TOKENS', async () => {
    // The notice must not be yielded on a pass with no visible text: that
    // would set hasText and skip the follow-up call that writes the reply.
    async function* firstStream() {
      yield {
        candidates: [
          {
            finishReason: 'MAX_TOKENS',
            content: {
              parts: [{ functionCall: { name: 'get_hacker_news_briefing', args: {} } }],
            },
          },
        ],
      }
    }
    async function* followUpStream() {
      yield textChunk('# ☕ Morning Coffee Briefing')
    }
    mockSendMessageStream.mockResolvedValueOnce({ stream: firstStream() })
    mockGenerateContentStream.mockResolvedValueOnce({ stream: followUpStream() })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const executeFn: FunctionExecutor = vi.fn().mockResolvedValue({ stories: [] })
    const provider = new GeminiProvider('fake-key')
    const items = await collectStream(provider.chatStream([], 'Morning briefing', executeFn))

    expect(mockGenerateContentStream).toHaveBeenCalledTimes(1)
    expect(items).toEqual(['# ☕ Morning Coffee Briefing'])
    warnSpy.mockRestore()
  })

  it('stops the stream and appends a notice when the model loops', async () => {
    // Regression: with maxOutputTokens at 15000, a repetition loop ("Let me
    // know if you'd like to review your English mistakes...") used to run for
    // thousands of tokens before the truncation notice kicked in.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const loopSentence =
      "Let me know if you'd like to review your English mistakes from this conversation. "
    let chunksConsumed = 0
    async function* fakeStream() {
      yield textChunk('Enjoy diving into the threads! ')
      for (let i = 0; i < 100; i++) {
        chunksConsumed++
        yield textChunk(loopSentence)
      }
    }
    mockSendMessageStream.mockResolvedValue({ stream: fakeStream() })
    const provider = new GeminiProvider('fake-key')
    const items = await collectStream(provider.chatStream([], 'Hi', noopExecutor))

    expect(items[0]).toBe('Enjoy diving into the threads! ')
    expect(items[items.length - 1]).toBe(REPETITION_NOTICE)
    // The stream must be abandoned shortly after the loop is confirmed, not
    // drained to the end.
    expect(chunksConsumed).toBeLessThan(10)
    // The request itself must be aborted: the SDK pumps the response to the
    // end even when nothing reads the stream, so without an abort Gemini
    // keeps generating (and billing) up to maxOutputTokens.
    const requestOptions = mockSendMessageStream.mock.calls[0][1] as { signal: AbortSignal }
    expect(requestOptions.signal.aborted).toBe(true)
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('does not abort the request on a normal reply', async () => {
    async function* fakeStream() {
      yield textChunk('A perfectly ordinary answer.')
    }
    mockSendMessageStream.mockResolvedValue({ stream: fakeStream() })
    const provider = new GeminiProvider('fake-key')
    await collectStream(provider.chatStream([], 'Hi', noopExecutor))
    const requestOptions = mockSendMessageStream.mock.calls[0][1] as { signal: AbortSignal }
    expect(requestOptions.signal.aborted).toBe(false)
  })

  it('stops the follow-up stream when the model loops after a tool call', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    async function* firstStream() {
      yield {
        candidates: [
          {
            content: {
              parts: [{ functionCall: { name: 'get_hacker_news_briefing', args: {} } }],
            },
          },
        ],
      }
    }
    const loopSentence = 'Let me know where you would like to go next! '
    async function* followUpStream() {
      yield textChunk('# ☕ Morning Coffee Briefing\n\nStories here.\n\n')
      for (let i = 0; i < 100; i++) yield textChunk(loopSentence)
    }
    mockSendMessageStream.mockResolvedValueOnce({ stream: firstStream() })
    // The real SDK result carries an aggregate response promise that rejects
    // once the request is aborted; the provider must observe that rejection
    // or the abort crashes the process (vitest fails on unhandled rejections,
    // so this test doubles as coverage for the rejection handler).
    mockGenerateContentStream.mockImplementationOnce(async () => ({
      stream: followUpStream(),
      response: Promise.reject(new Error('Request aborted when reading from the stream')),
    }))

    const executeFn: FunctionExecutor = vi.fn().mockResolvedValue({ stories: [] })
    const provider = new GeminiProvider('fake-key')
    const items = await collectStream(provider.chatStream([], 'Morning briefing', executeFn))

    expect(items[0]).toBe('# ☕ Morning Coffee Briefing\n\nStories here.\n\n')
    expect(items[items.length - 1]).toBe(REPETITION_NOTICE)
    const requestOptions = mockGenerateContentStream.mock.calls[0][1] as { signal: AbortSignal }
    expect(requestOptions.signal.aborted).toBe(true)
    warnSpy.mockRestore()
  })

  it('yields suggestions from a separate flash-lite call after the reply', async () => {
    async function* fakeStream() {
      yield textChunk('Here are your options.')
    }
    mockSendMessageStream.mockResolvedValue({ stream: fakeStream() })
    mockGenerateContent.mockResolvedValueOnce(suggestionResult(['Yes', 'No', 'Maybe']))
    const provider = new GeminiProvider('fake-key')
    const items = await collectStream(provider.chatStream([], 'Give me options', noopExecutor))
    expect(items).toEqual([
      'Here are your options.',
      { type: 'suggestions', items: ['Yes', 'No', 'Maybe'] },
    ])
  })

  it('generates suggestions with the flash-lite model and JSON output', async () => {
    async function* fakeStream() {
      yield textChunk('A reply.')
    }
    mockSendMessageStream.mockResolvedValue({ stream: fakeStream() })
    mockGenerateContent.mockResolvedValueOnce(suggestionResult(['One', 'Two']))
    const provider = new GeminiProvider('fake-key')
    await collectStream(provider.chatStream([], 'Hi', noopExecutor))
    expect(mockGetGenerativeModel).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-2.5-flash-lite',
        generationConfig: expect.objectContaining({ responseMimeType: 'application/json' }),
      })
    )
  })

  it('clamps suggestions to at most 4 and drops blank labels', async () => {
    async function* fakeStream() {
      yield textChunk('A reply.')
    }
    mockSendMessageStream.mockResolvedValue({ stream: fakeStream() })
    mockGenerateContent.mockResolvedValueOnce(suggestionResult(['a', '  ', 'b', 'c', 'd', 'e']))
    const provider = new GeminiProvider('fake-key')
    const items = await collectStream(provider.chatStream([], 'Hi', noopExecutor))
    expect(items).toContainEqual({ type: 'suggestions', items: ['a', 'b', 'c', 'd'] })
  })

  it('yields no suggestions when the flash-lite call returns an empty list', async () => {
    async function* fakeStream() {
      yield textChunk('A complete answer.')
    }
    mockSendMessageStream.mockResolvedValue({ stream: fakeStream() })
    mockGenerateContent.mockResolvedValueOnce(suggestionResult([]))
    const provider = new GeminiProvider('fake-key')
    const items = await collectStream(provider.chatStream([], 'Hi', noopExecutor))
    expect(items).toEqual(['A complete answer.'])
  })

  it('does not fail the reply when suggestion generation throws', async () => {
    async function* fakeStream() {
      yield textChunk('A reply.')
    }
    mockSendMessageStream.mockResolvedValue({ stream: fakeStream() })
    mockGenerateContent.mockRejectedValueOnce(new Error('flash-lite down'))
    const provider = new GeminiProvider('fake-key')
    const items = await collectStream(provider.chatStream([], 'Hi', noopExecutor))
    expect(items).toEqual(['A reply.'])
  })

  it('does not request suggestions when the reply is empty', async () => {
    async function* fakeStream() {
      // No text parts: nothing was generated.
    }
    mockSendMessageStream.mockResolvedValue({ stream: fakeStream() })
    const provider = new GeminiProvider('fake-key')
    await collectStream(provider.chatStream([], 'Hi', noopExecutor))
    expect(mockGenerateContent).not.toHaveBeenCalled()
  })

  it('includes googleSearch tool when googleSearch option is true', async () => {
    async function* fakeStream() {
      yield textChunk('result')
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
      yield textChunk('result')
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
      yield textChunk('result')
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
        candidates: [{ content: { parts: [rawFunctionCallPart] } }],
      }
    }
    async function* followUpStream() {
      yield textChunk('Great effort! Keep practicing.')
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
        candidates: [{ content: { parts: [rawFunctionCallPart] } }],
      }
    }
    async function* followUpStream() {
      yield textChunk('Sounds great! (More natural: ... → ...)')
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
      yield textChunk('Here are your mistakes for today.')
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

  it('sends only functionResponse parts in the follow-up user turn', async () => {
    // Regression: mixing a text part into the functionResponse turn disrupts the
    // thinking model's turn continuation and makes it write its reasoning as
    // visible reply text.
    async function* firstStream() {
      yield {
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
      yield textChunk('Briefing text')
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
    expect(responseTurn.parts).toEqual([
      {
        functionResponse: {
          name: 'get_hacker_news_briefing',
          response: { stories: [] },
        },
      },
    ])
  })

  it('still triggers the follow-up when the primary turn has only thoughts and a tool call', async () => {
    async function* firstStream() {
      yield {
        candidates: [
          {
            content: {
              parts: [{ text: 'Thinking about which tool to use...', thought: true }],
            },
          },
        ],
      }
      yield {
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
      yield textChunk('# ☕ Morning Coffee Briefing')
    }
    mockSendMessageStream.mockResolvedValueOnce({ stream: firstStream() })
    mockGenerateContentStream.mockResolvedValueOnce({ stream: followUpStream() })

    const executeFn: FunctionExecutor = vi.fn().mockResolvedValue({ stories: [] })
    const provider = new GeminiProvider('fake-key')
    const items = await collectStream(provider.chatStream([], 'Morning briefing', executeFn))

    expect(mockGenerateContentStream).toHaveBeenCalledTimes(1)
    expect(items).toEqual(['# ☕ Morning Coffee Briefing'])
  })

  it('generates suggestions after a tool-driven follow-up reply', async () => {
    async function* firstStream() {
      yield {
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
      yield textChunk('# ☕ Morning Coffee Briefing')
    }
    mockSendMessageStream.mockResolvedValueOnce({ stream: firstStream() })
    mockGenerateContentStream.mockResolvedValueOnce({ stream: followUpStream() })
    mockGenerateContent.mockResolvedValueOnce(
      suggestionResult(['More on: Rust async', 'More on: YC stats'])
    )

    const executeFn: FunctionExecutor = vi.fn().mockResolvedValue({ stories: [] })
    const provider = new GeminiProvider('fake-key')
    const items = await collectStream(provider.chatStream([], 'Morning briefing', executeFn))

    expect(items).toEqual([
      '# ☕ Morning Coffee Briefing',
      { type: 'suggestions', items: ['More on: Rust async', 'More on: YC stats'] },
    ])
  })

  it('calls executeFn for unknown function calls', async () => {
    async function* fakeStream() {
      yield {
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
      yield textChunk('Done.')
    }
    mockSendMessageStream.mockResolvedValueOnce({ stream: fakeStream() })
    mockGenerateContentStream.mockResolvedValueOnce({ stream: followUpStream() })

    const executeFn: FunctionExecutor = vi.fn().mockResolvedValue({ error: 'unknown function' })
    const provider = new GeminiProvider('fake-key')
    await collectStream(provider.chatStream([], 'Hi', executeFn))

    expect(executeFn).toHaveBeenCalledWith('unknown_tool', {})
  })
})
