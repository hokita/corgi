import { beforeEach, describe, it, expect, vi } from 'vitest'
import {
  NodeTracerProvider,
  SimpleSpanProcessor,
  InMemorySpanExporter,
} from '@opentelemetry/sdk-trace-node'

const exporter = new InMemorySpanExporter()
const tracerProvider = new NodeTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
})
tracerProvider.register()

const mockGenerateContent = vi.fn()
const mockGetGenerativeModel = vi.fn(() => ({
  generateContent: mockGenerateContent,
}))

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
    getGenerativeModel: mockGetGenerativeModel,
  })),
}))

import { GeminiTitleGenerator } from './GeminiTitleGenerator'

function finishedSpan(name: string) {
  return exporter.getFinishedSpans().find((s) => s.name === name)
}

beforeEach(() => {
  vi.clearAllMocks()
  exporter.reset()
})

describe('GeminiTitleGenerator tracing', () => {
  it('records a trace span and a nested generation with usage', async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () => 'Learning Japanese Basics',
        usageMetadata: { promptTokenCount: 40, candidatesTokenCount: 6, totalTokenCount: 46 },
      },
    })
    const gen = new GeminiTitleGenerator('fake-key')
    await gen.generateTitle('I want to start learning Japanese')

    const root = finishedSpan('generate-title')
    expect(root).toBeDefined()
    expect(JSON.parse(String(root!.attributes['langfuse.observation.input']))).toBe(
      'I want to start learning Japanese'
    )
    expect(JSON.parse(String(root!.attributes['langfuse.observation.output']))).toBe(
      'Learning Japanese Basics'
    )

    const generation = finishedSpan('gemini-title')
    expect(generation).toBeDefined()
    expect(generation!.attributes['langfuse.observation.type']).toBe('generation')
    expect(generation!.attributes['langfuse.observation.model.name']).toBe('gemini-2.5-flash-lite')
    expect(
      JSON.parse(String(generation!.attributes['langfuse.observation.usage_details']))
    ).toEqual({ input: 40, output: 6, total: 46 })
    // OTel 1.x: use generation.parentSpanId instead
    expect(generation!.parentSpanContext?.spanId).toBe(root!.spanContext().spanId)
  })

  it('marks spans as ERROR and records the fallback title on failure', async () => {
    mockGenerateContent.mockRejectedValue(new Error('API error'))
    const gen = new GeminiTitleGenerator('fake-key')
    const title = await gen.generateTitle('A'.repeat(60))
    expect(title).toBe('A'.repeat(40))

    const generation = finishedSpan('gemini-title')
    expect(generation).toBeDefined()
    expect(generation!.attributes['langfuse.observation.level']).toBe('ERROR')

    const root = finishedSpan('generate-title')
    expect(root).toBeDefined()
    expect(root!.attributes['langfuse.observation.level']).toBe('ERROR')
    expect(JSON.parse(String(root!.attributes['langfuse.observation.output']))).toBe('A'.repeat(40))
  })
})
