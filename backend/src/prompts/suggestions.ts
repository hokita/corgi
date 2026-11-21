export const SUGGESTION_SYSTEM_PROMPT =
  'You generate tappable suggestion buttons for a chat UI. Given the conversation and the ' +
  "assistant's latest reply, return 2 to 4 short button labels (each 2–6 words) that the user " +
  'is most likely to tap next. When the user is exploring or brainstorming, make the labels ' +
  'thought-provoking follow-up questions that deepen their thinking. Otherwise make them useful ' +
  'next steps or options. If the reply is a news briefing, digest, or list of items, use the ' +
  'format "More on: <2–6 word topic>". Keep labels concise and free of numbering, emoji, and ' +
  'quotes. If no buttons would genuinely help the user (for example the reply already fully ' +
  'closes the topic), return an empty list.'

export function buildSuggestionPrompt(
  history: { role: 'user' | 'assistant'; content: string }[],
  userMessage: string,
  assistantReply: string
): string {
  const recent = history.slice(-6)
  const transcript = [
    ...recent.map((m) => `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${m.content}`),
    `User: ${userMessage}`,
    `Assistant: ${assistantReply}`,
  ].join('\n')
  return (
    `Conversation so far:\n${transcript}\n\n` +
    'Return the suggestion button labels for what the user might do next.'
  )
}
