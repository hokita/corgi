import { beforeEach, describe, it, expect, vi } from 'vitest'

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

describe('GeminiTitleGenerator', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns AI-generated title', async () => {
    mockGenerateContent.mockResolvedValue({
      response: { text: () => 'Learning Japanese Basics' },
    })
    const gen = new GeminiTitleGenerator('fake-key')
    const title = await gen.generateTitle('I want to start learning Japanese')
    expect(title).toBe('Learning Japanese Basics')
  })

  it('falls back to truncation on error', async () => {
    mockGenerateContent.mockRejectedValue(new Error('API error'))
    const gen = new GeminiTitleGenerator('fake-key')
    const title = await gen.generateTitle('A'.repeat(60))
    expect(title).toBe('A'.repeat(40))
  })
})
