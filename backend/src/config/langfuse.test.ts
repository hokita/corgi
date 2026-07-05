import { describe, it, expect } from 'vitest'
import { trace } from '@opentelemetry/api'
import { initLangfuse, flushLangfuse, shutdownLangfuse, toUsageDetails } from './langfuse'

describe('toUsageDetails', () => {
  it('maps Gemini usage fields to Langfuse usage details', () => {
    expect(
      toUsageDetails({
        promptTokenCount: 10,
        candidatesTokenCount: 20,
        thoughtsTokenCount: 5,
        totalTokenCount: 35,
      })
    ).toEqual({ input: 10, output: 20, reasoning: 5, total: 35 })
  })

  it('omits absent fields', () => {
    expect(toUsageDetails({ promptTokenCount: 3, totalTokenCount: 3 })).toEqual({
      input: 3,
      total: 3,
    })
  })

  it('returns undefined when usage is missing', () => {
    expect(toUsageDetails(undefined)).toBeUndefined()
  })

  it('returns undefined when usage has no counts', () => {
    expect(toUsageDetails({})).toBeUndefined()
  })
})

describe('when Langfuse keys are not configured', () => {
  it('initLangfuse does not register a recording tracer', () => {
    delete process.env.LANGFUSE_PUBLIC_KEY
    delete process.env.LANGFUSE_SECRET_KEY
    initLangfuse()
    const span = trace.getTracer('test').startSpan('probe')
    expect(span.isRecording()).toBe(false)
    span.end()
  })

  it('flushLangfuse resolves', async () => {
    await expect(flushLangfuse()).resolves.toBeUndefined()
  })

  it('shutdownLangfuse resolves', async () => {
    await expect(shutdownLangfuse()).resolves.toBeUndefined()
  })
})
