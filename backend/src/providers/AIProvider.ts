export interface Message {
  role: 'user' | 'assistant'
  content: string
}

export type StreamItem = string | { type: 'suggestions'; items: string[] }

export type FunctionExecutor = (name: string, args: unknown) => Promise<unknown>

export interface AIProvider {
  chatStream(
    history: Message[],
    newMessage: string,
    executeFn: FunctionExecutor
  ): AsyncIterable<StreamItem>
}

export interface TitleGenerator {
  generateTitle(message: string): Promise<string>
}
