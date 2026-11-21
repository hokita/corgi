const MIN_PATTERN_LENGTH = 10
const MAX_PATTERN_LENGTH = 400
const MIN_REPEATS = 3
const MIN_REPEATED_SPAN = 240

const WINDOW_SIZE = MAX_PATTERN_LENGTH * (MIN_REPEATS + 1)

export class RepetitionGuard {
  private tail = ''

  append(text: string): boolean {
    this.tail = (this.tail + text).slice(-WINDOW_SIZE)
    return hasRepeatingTail(this.tail)
  }
}

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
