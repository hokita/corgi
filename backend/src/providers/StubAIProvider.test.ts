import { describe, it, expect } from 'vitest'
import { StubAIProvider } from './StubAIProvider'

describe('StubAIProvider', () => {
  it('yields a fixed reply as multiple chunks', async () => {
    const provider = new StubAIProvider()
    const chunks: string[] = []
    for await (const item of provider.chatStream([], 'hi', async () => undefined)) {
      chunks.push(item as string)
    }
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.join('')).toBe('This is a stub reply.')
  })
})
