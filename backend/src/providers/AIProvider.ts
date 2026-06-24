export interface Message {
  role: 'user' | 'assistant'
  content: string
}

export type StreamItem = string | { type: 'suggestions'; items: string[] }

export interface AIProvider {
  chatStream(history: Message[], newMessage: string): AsyncIterable<StreamItem>
}
