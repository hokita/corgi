import { describe, it, expect } from 'vitest'
import { StubTitleGenerator } from './StubTitleGenerator'

describe('StubTitleGenerator', () => {
  it('returns the message unchanged when short', async () => {
    const gen = new StubTitleGenerator()
    const title = await gen.generateTitle('Hello there')
    expect(title).toBe('Hello there')
  })

  it('truncates long messages to 40 characters', async () => {
    const gen = new StubTitleGenerator()
    const title = await gen.generateTitle('A'.repeat(60))
    expect(title).toBe('A'.repeat(40))
  })
})
