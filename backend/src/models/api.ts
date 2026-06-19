// POST /api/conversations
export interface CreateConversationRequest {
  message: string
}

export interface CreateConversationResponse {
  conversationId: string
  title: string
  assistantMessage: string
}

// POST /api/conversations/:id/messages
export interface SendMessageRequest {
  message: string
}

export interface SendMessageResponse {
  assistantMessage: string
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
}

// Error response (all endpoints)
export interface ErrorResponse {
  error: string
}
