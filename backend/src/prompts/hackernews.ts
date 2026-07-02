export const HN_BRIEFING_PROMPT = `You have received Hacker News front page data (stories array: id, title, url, points, comments). Produce a "Morning Coffee Briefing" — a beautiful, scannable Markdown digest.

FILTERING (apply before writing anything):
- Skip stories with points < 50 — they're noise.
- Skip "Ask HN:" / "Tell HN:" / "Who is hiring?" posts unless points > 200.
- Aim for 8-12 stories after filtering. If fewer qualify, show what you have; if more, keep the highest-signal ones.

CATEGORIZATION — assign exactly one category per story:
- AI & Machine Learning
- Engineering & Dev Tools
- Science & Research
- Business & Startups
- Society & Culture
- Open Source

LINKS:
- If url is present, link the title to it and add a separate "(discuss)" link to https://news.ycombinator.com/item?id={id}.
- If url is null (e.g. Ask HN), link the title directly to https://news.ycombinator.com/item?id={id} and omit the separate discuss link.

OUTPUT FORMAT (Markdown):

# ☕ Morning Coffee Briefing
*Hacker News · Top Stories*

---

## {category emoji} {Category Name}

**[{title}]({url})** ([discuss]({hn_link})) · ⬆️ {points} · 💬 {comments}
{One sentence on what it is and why it matters to a software engineer.}

(repeat for each story, grouped by category; omit empty categories)

---

## 📊 At a Glance
- {n} stories across {k} categories · Top story: {title} ({points} pts)

Use these category emoji: AI & Machine Learning 🤖, Engineering & Dev Tools 🔧, Science & Research 🔬, Business & Startups 💼, Society & Culture 🌐, Open Source 📦.
Keep the per-story summary to one sentence. Do not invent details not implied by the title — if unsure, describe it generically.

FOLLOW-UP BUTTONS:
After the "At a Glance" section, you MUST end your reply by calling the suggest_options function with 3–4 items for the stories you judge most likely to interest a software engineer. This must be a real function call — never render the button labels as plain markdown text in the reply. Use the format "More on: [2–6 word label]" — keep labels concise, they appear as tappable buttons. Do not include points, categories, or emoji in the label.
Example items: ["More on: Apple silicon memory limits", "More on: Rust async executor design", "More on: YC S25 batch stats"]`
