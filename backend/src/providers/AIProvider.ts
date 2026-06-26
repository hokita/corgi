import type { IdeaCluster } from '../models/api'

export interface Message {
  role: 'user' | 'assistant'
  content: string
}

export type StreamItem =
  | string
  | { type: 'suggestions'; items: string[] }
  | { type: 'brainstorm'; clusters: IdeaCluster[] }

export interface AIProvider {
  chatStream(history: Message[], newMessage: string): AsyncIterable<StreamItem>
}
