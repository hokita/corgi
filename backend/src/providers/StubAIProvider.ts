import type { AIProvider, StreamItem } from './AIProvider'

export class StubAIProvider implements AIProvider {
  async *chatStream(): AsyncIterable<StreamItem> {
    yield 'This '
    yield 'is a stub reply.'
  }
}
