export interface Message {
  role: 'user' | 'assistant'
  content: string
}

export interface AIProvider {
  chat(history: Message[], newMessage: string): Promise<string>
}
