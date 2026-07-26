import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Router } from 'express'

const { mockGeminiProvider, mockGeminiTitleGenerator, mockCreateConversationsRouter } = vi.hoisted(
  () => ({
    mockGeminiProvider: vi.fn(),
    mockGeminiTitleGenerator: vi.fn(),
    mockCreateConversationsRouter: vi.fn(() => Router()),
  })
)

vi.mock('./providers/GeminiProvider', () => ({
  GeminiProvider: mockGeminiProvider,
}))
vi.mock('./providers/GeminiTitleGenerator', () => ({
  GeminiTitleGenerator: mockGeminiTitleGenerator,
}))
vi.mock('./routes/conversations', () => ({
  createConversationsRouter: mockCreateConversationsRouter,
}))
vi.mock('./middleware/auth', () => ({
  authMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
}))

import { createApp } from './app'

describe('createApp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.GEMINI_API_KEY = 'fake-key'
  })

  it('defaults to real Gemini providers when no overrides are given', () => {
    createApp()
    expect(mockGeminiProvider).toHaveBeenCalledOnce()
    expect(mockGeminiTitleGenerator).toHaveBeenCalledOnce()
    expect(mockCreateConversationsRouter).toHaveBeenCalledOnce()
  })

  it('uses provided overrides instead of constructing Gemini providers', () => {
    const stubAI = { chatStream: vi.fn() }
    const stubTitleGen = { generateTitle: vi.fn() }
    createApp({ ai: stubAI as never, titleGen: stubTitleGen as never })
    expect(mockGeminiProvider).not.toHaveBeenCalled()
    expect(mockGeminiTitleGenerator).not.toHaveBeenCalled()
    expect(mockCreateConversationsRouter).toHaveBeenCalledWith(stubAI, stubTitleGen)
  })
})
