import { describe, it, expect } from 'vitest'
import { RepetitionGuard } from './repetitionGuard'

const LOOP_SENTENCE =
  "Let me know if you'd like to review your English mistakes from this conversation. "

function feed(guard: RepetitionGuard, text: string, chunkSize = 20): boolean {
  for (let i = 0; i < text.length; i += chunkSize) {
    if (guard.append(text.slice(i, i + chunkSize))) return true
  }
  return false
}

describe('RepetitionGuard', () => {
  it('detects a sentence-length repetition loop', () => {
    const guard = new RepetitionGuard()
    expect(feed(guard, 'Enjoy diving into the threads! ' + LOOP_SENTENCE.repeat(6))).toBe(true)
  })

  it('detects a loop even when the stream stops mid-copy', () => {
    const guard = new RepetitionGuard()
    const text = LOOP_SENTENCE.repeat(5) + LOOP_SENTENCE.slice(0, 30)
    expect(feed(guard, text)).toBe(true)
  })

  it('detects a short pattern once it covers enough characters', () => {
    const guard = new RepetitionGuard()
    expect(feed(guard, 'Let me know! '.repeat(40))).toBe(true)
  })

  it('does not flag normal prose', () => {
    const guard = new RepetitionGuard()
    const prose =
      'Here are the top Hacker News stories today. The first covers a new Rust async ' +
      'runtime that claims lower latency than Tokio. The second is a look back at ten ' +
      'years of YC startup outcomes, with some surprising stats on B2B vs consumer. ' +
      'The comments dig into methodology concerns and survivorship bias. Finally, a ' +
      'show-and-tell of a homebrew CPU built entirely from discrete transistors.'
    expect(feed(guard, prose)).toBe(false)
  })

  it('does not flag a few legitimate repeats below the span threshold', () => {
    const guard = new RepetitionGuard()
    expect(feed(guard, 'That is correct. That is correct. That is correct.')).toBe(false)
  })

  it('does not flag markdown horizontal rules or table separators', () => {
    const guard = new RepetitionGuard()
    expect(feed(guard, 'Intro\n\n' + '-'.repeat(60) + '\n\n| --- | --- | --- |\n')).toBe(false)
  })

  it('detects repetition split arbitrarily across chunk boundaries', () => {
    const guard = new RepetitionGuard()
    expect(feed(guard, LOOP_SENTENCE.repeat(6), 7)).toBe(true)
  })
})
