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
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  if (res.status === 204) return undefined as T
  return res.json()
}

export interface StreamCallbacks {
  onMeta?: (meta: { conversationId: string; title: string }) => void
  onChunk: (text: string) => void
  onSuggestions?: (items: string[]) => void
  onDone: () => void
  onError: (message: string) => void
}

async function streamRequest(
  path: string,
  body: unknown,
  callbacks: StreamCallbacks
): Promise<void> {
  const token = await auth.currentUser?.getIdToken()
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`API error: ${res.status}`)

  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop()!
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const event = JSON.parse(line.slice(6)) as {
        type: string
        text?: string
        conversationId?: string
        title?: string
        message?: string
        items?: string[]
      }
      if (event.type === 'chunk') callbacks.onChunk(event.text!)
      else if (event.type === 'meta')
        callbacks.onMeta?.({ conversationId: event.conversationId!, title: event.title! })
      else if (event.type === 'suggestions') callbacks.onSuggestions?.(event.items!)
      else if (event.type === 'done') callbacks.onDone()
      else if (event.type === 'error') callbacks.onError(event.message!)
    }
  }
}

export const api = {
  listConversations: () => request<Conversation[]>('/api/conversations'),

  getMessages: (conversationId: string) =>
    request<Message[]>(`/api/conversations/${conversationId}/messages`),

  createConversation: (message: string, callbacks: StreamCallbacks) =>
    streamRequest('/api/conversations', { message }, callbacks),

  sendMessage: (conversationId: string, message: string, callbacks: StreamCallbacks) =>
    streamRequest(`/api/conversations/${conversationId}/messages`, { message }, callbacks),

  deleteConversation: (conversationId: string) =>
    request<void>(`/api/conversations/${conversationId}`, { method: 'DELETE' }),
}
