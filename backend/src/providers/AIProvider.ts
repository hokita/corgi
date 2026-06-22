export interface Message {
  role: 'user' | 'assistant'
  content: string
}

export interface AIProvider {
  chatStream(history: Message[], newMessage: string): AsyncIterable<string>
}
