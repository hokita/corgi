// Detects degenerate repetition loops in streamed model output — the model
// emitting the same sentence over and over until it hits maxOutputTokens.
// Prompt tweaks only remove individual triggers (see 2cb8932); this guard is
// the backstop that works regardless of what set the loop off.
//
// A loop is flagged when the tail of the streamed text is consecutive copies
// of one pattern covering at least MIN_REPEATED_SPAN characters. Tying the
// threshold to the repeated span (not the repeat count) means short patterns
// must repeat many times before tripping it, so legitimate short repetition
// (markdown rules, "ha ha ha") passes through.
const MIN_PATTERN_LENGTH = 10
const MAX_PATTERN_LENGTH = 400
const MIN_REPEATS = 3
const MIN_REPEATED_SPAN = 240

const WINDOW_SIZE = MAX_PATTERN_LENGTH * (MIN_REPEATS + 1)

export class RepetitionGuard {
  private tail = ''

  /** Feed streamed text; returns true once the tail is a repetition loop. */
  append(text: string): boolean {
    this.tail = (this.tail + text).slice(-WINDOW_SIZE)
    return hasRepeatingTail(this.tail)
  }
}

// Periodicity is checked from the end of the string, so it still matches when
// the stream stops mid-copy: any window of a periodic string equals the window
// one period earlier, whether or not it is aligned to a copy boundary.
function hasRepeatingTail(s: string): boolean {
  const n = s.length
  const maxPattern = Math.min(MAX_PATTERN_LENGTH, Math.floor(n / MIN_REPEATS))
  for (let period = MIN_PATTERN_LENGTH; period <= maxPattern; period++) {
    if (s[n - 1] !== s[n - 1 - period]) continue
    const repeats = Math.max(MIN_REPEATS, Math.ceil(MIN_REPEATED_SPAN / period))
    if (period * repeats > n) continue
    const pattern = s.slice(n - period)
    let matched = true
    for (let i = 1; i < repeats; i++) {
      if (s.slice(n - (i + 1) * period, n - i * period) !== pattern) {
        matched = false
        break
      }
    }
    if (matched) return true
  }
  return false
}
