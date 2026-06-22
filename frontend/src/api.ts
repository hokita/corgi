import { auth } from './firebase'
import type { Conversation, Message } from './types'

const BASE_URL = import.meta.env.VITE_API_URL ?? ''

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = await auth.currentUser?.getIdToken()
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...options?.headers,
    },
  })
  if (res.status === 529) throw new Error('The AI model is currently overloaded. Please try again later.')
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  if (res.status === 204) return undefined as T
  return res.json()
}

export const api = {
  listConversations: () =>
    request<Conversation[]>('/api/conversations'),

  getMessages: (conversationId: string) =>
    request<Message[]>(`/api/conversations/${conversationId}/messages`),

  createConversation: (message: string) =>
    request<{ conversationId: string; title: string; assistantMessage: string }>(
      '/api/conversations',
      { method: 'POST', body: JSON.stringify({ message }) }
    ),

  sendMessage: (conversationId: string, message: string) =>
    request<{ assistantMessage: string }>(
      `/api/conversations/${conversationId}/messages`,
      { method: 'POST', body: JSON.stringify({ message }) }
    ),

  deleteConversation: (conversationId: string) =>
    request<void>(`/api/conversations/${conversationId}`, { method: 'DELETE' }),
}
