import type { EnglishMistakeData } from '../models/api'

export interface Message {
  role: 'user' | 'assistant'
  content: string
}

export type StreamItem =
  | string
  | { type: 'suggestions'; items: string[] }
  | { type: 'save_english_mistake'; data: EnglishMistakeData }

export interface AIProvider {
  chatStream(history: Message[], newMessage: string): AsyncIterable<StreamItem>
}
