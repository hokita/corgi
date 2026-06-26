export interface IdeaCluster {
  label: string
  ideas: { label: string; description: string }[]
}

export interface Conversation {
  id: string
  title: string
  lastMessage: string
  updatedAt: string
}

export interface Message {
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  suggestions?: string[]
  clusters?: IdeaCluster[]
}
