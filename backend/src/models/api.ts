// POST /api/conversations
export interface CreateConversationRequest {
  message: string
}

// POST /api/conversations/:id/messages
export interface SendMessageRequest {
  message: string
}

// GET /api/conversations
export interface ConversationSummary {
  id: string
  title: string
  lastMessage: string
  updatedAt: string
}

// GET /api/conversations/:id/messages
export interface MessageResponse {
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  suggestions?: string[]
}

// Shared shape for an English learning record
export interface EnglishMistakeData {
  originalText: string
  correctedText: string
  category: string
  severity: string
  patternKey: string
}

// SSE event types for POST /api/conversations and POST /api/conversations/:id/messages
export type SSEEvent =
  | { type: 'meta'; conversationId: string; title: string }
  | { type: 'chunk'; text: string }
  | { type: 'suggestions'; items: string[] }
  | { type: 'progress'; message: string }
  | { type: 'done' }
  | { type: 'error'; message: string }

// Error response (all non-SSE endpoints)
export interface ErrorResponse {
  error: string
}
