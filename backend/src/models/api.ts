export interface CreateConversationRequest {
  message: string
}

export interface SendMessageRequest {
  message: string
}

export interface ConversationSummary {
  id: string
  title: string
  lastMessage: string
  updatedAt: string
}

export interface MessageResponse {
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  suggestions?: string[]
}

export interface EnglishMistakeData {
  originalText: string
  correctedText: string
  category: string
  severity: string
  patternKey: string
  type: 'mistake' | 'suggestion'
}

export interface EnglishMistakeDoc extends EnglishMistakeData {
  id: string
  uid: string
  conversationId: string
  createdAt: string
}

export interface GetMistakesParams {
  startDate?: string
  endDate?: string
  category?: string
  limit?: number
}

export type SSEEvent =
  | { type: 'meta'; conversationId: string; title: string }
  | { type: 'chunk'; text: string }
  | { type: 'suggestions'; items: string[] }
  | { type: 'progress'; message: string }
  | { type: 'done' }
  | { type: 'error'; message: string }

export interface ErrorResponse {
  error: string
}
