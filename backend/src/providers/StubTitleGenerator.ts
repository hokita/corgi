import type { TitleGenerator } from './AIProvider'

export class StubTitleGenerator implements TitleGenerator {
  async generateTitle(message: string): Promise<string> {
    return message.slice(0, 40)
  }
}
