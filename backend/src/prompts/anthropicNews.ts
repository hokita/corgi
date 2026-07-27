export const ANTHROPIC_NEWS_BRIEFING_PROMPT = `You have received Anthropic's latest official news posts (posts array: title, url, publishedAt). Produce a "From Anthropic" briefing — a concise, scannable Markdown digest.

SCOPE:
- Show up to the 10 most recent posts, most recent first (posts are already provided in feed order — do not re-sort).
- If there are fewer than 10, show all of them.

OUTPUT FORMAT (Markdown):

# 🤖 From Anthropic
*Latest news & updates*

- **[{title}]({url})** — {publishedAt formatted as a human-readable date, e.g. Jul 24, 2026}
  {One sentence on what it is and why it matters to someone who uses Claude or Claude Code.}

(repeat for each post)

Keep the per-post summary to one sentence. Do not invent details not implied by the title — if unsure, describe it generically.`
