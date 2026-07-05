import { beforeEach, describe, it, expect, vi } from 'vitest'
import {
  NodeTracerProvider,
  SimpleSpanProcessor,
  InMemorySpanExporter,
} from '@opentelemetry/sdk-trace-node'
import { startActiveObservation } from '@langfuse/tracing'
import type { StreamItem, FunctionExecutor } from './AIProvider'

const exporter = new InMemorySpanExporter()
const tracerProvider = new NodeTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
})
tracerProvider.register()

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

function textChunk(text: string) {
  return { candidates: [{ content: { parts: [{ text }] } }] }
}

function finishedSpan(name: string) {
  return exporter.getFinishedSpans().find((s) => s.name === name)
}

beforeEach(() => {
  vi.clearAllMocks()
  exporter.reset()
})

describe('GeminiProvider tracing: primary generation', () => {
  it('records a generation span with model, output, and usage', async () => {
    async function* fakeStream() {
      yield textChunk('Hello')
      yield {
        candidates: [{ content: { parts: [{ text: ' world' }] } }],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 7, totalTokenCount: 12 },
      }
    }
    mockSendMessageStream.mockResolvedValue({ stream: fakeStream() })
    const provider = new GeminiProvider('fake-key')
    await collectStream(provider.chatStream([], 'Hi', noopExecutor))

    const gen = finishedSpan('gemini-chat')
    expect(gen).toBeDefined()
    expect(gen!.attributes['langfuse.observation.type']).toBe('generation')
    expect(gen!.attributes['langfuse.observation.model.name']).toBe('gemini-3.5-flash')
    expect(JSON.parse(String(gen!.attributes['langfuse.observation.output']))).toBe('Hello world')
    expect(JSON.parse(String(gen!.attributes['langfuse.observation.usage_details']))).toEqual({
      input: 5,
      output: 7,
      total: 12,
    })
  })

  it('marks the generation span as ERROR when the stream is blocked', async () => {
    async function* fakeStream() {
      yield textChunk('The story begins')
      yield { candidates: [{ finishReason: 'RECITATION', content: { parts: [] } }] }
    }
    mockSendMessageStream.mockResolvedValue({ stream: fakeStream() })
    const provider = new GeminiProvider('fake-key')
    await expect(collectStream(provider.chatStream([], 'Hi', noopExecutor))).rejects.toThrow()

    const gen = finishedSpan('gemini-chat')
    expect(gen).toBeDefined()
    expect(gen!.attributes['langfuse.observation.level']).toBe('ERROR')
    expect(String(gen!.attributes['langfuse.observation.status_message'])).toContain('RECITATION')
  })
})

describe('GeminiProvider tracing: tool calls and follow-up', () => {
  function toolCallThenFollowUp() {
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
        candidates: [{ content: { parts: [{ text: 'Briefing text' }] } }],
        usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 30, totalTokenCount: 80 },
      }
    }
    mockSendMessageStream.mockResolvedValueOnce({ stream: firstStream() })
    mockGenerateContentStream.mockResolvedValueOnce({ stream: followUpStream() })
  }

  it('records a tool span with input args and output', async () => {
    toolCallThenFollowUp()
    const executeFn: FunctionExecutor = vi.fn().mockResolvedValue({ stories: [] })
    const provider = new GeminiProvider('fake-key')
    await collectStream(provider.chatStream([], 'Morning briefing', executeFn))

    const tool = finishedSpan('tool:get_hacker_news_briefing')
    expect(tool).toBeDefined()
    expect(JSON.parse(String(tool!.attributes['langfuse.observation.input']))).toEqual({})
    expect(JSON.parse(String(tool!.attributes['langfuse.observation.output']))).toEqual({
      stories: [],
    })
  })

  it('records a follow-up generation span with its own usage', async () => {
    toolCallThenFollowUp()
    const executeFn: FunctionExecutor = vi.fn().mockResolvedValue({ stories: [] })
    const provider = new GeminiProvider('fake-key')
    await collectStream(provider.chatStream([], 'Morning briefing', executeFn))

    const followUp = finishedSpan('gemini-chat-followup')
    expect(followUp).toBeDefined()
    expect(followUp!.attributes['langfuse.observation.type']).toBe('generation')
    expect(JSON.parse(String(followUp!.attributes['langfuse.observation.output']))).toBe(
      'Briefing text'
    )
    expect(JSON.parse(String(followUp!.attributes['langfuse.observation.usage_details']))).toEqual({
      input: 50,
      output: 30,
      total: 80,
    })
  })

  it('nests provider spans under an active parent observation', async () => {
    toolCallThenFollowUp()
    const executeFn: FunctionExecutor = vi.fn().mockResolvedValue({ stories: [] })
    const provider = new GeminiProvider('fake-key')
    await startActiveObservation('chat', async () => {
      await collectStream(provider.chatStream([], 'Morning briefing', executeFn))
    })

    const root = finishedSpan('chat')!
    for (const name of ['gemini-chat', 'tool:get_hacker_news_briefing', 'gemini-chat-followup']) {
      const child = finishedSpan(name)!
      expect(child.spanContext().traceId).toBe(root.spanContext().traceId)
      // OTel 1.x: use child.parentSpanId instead
      expect(child.parentSpanContext?.spanId).toBe(root.spanContext().spanId)
    }
  })
})
