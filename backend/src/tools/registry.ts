import { SchemaType } from '@google/generative-ai'
import type { FunctionDeclaration } from '@google/generative-ai'
import type { FunctionExecutor } from '../providers/AIProvider'
import type { EnglishMistakeData, GetMistakesParams } from '../models/api'
import * as db from '../services/firestore'
import { getHNStories } from '../services/hnCache'
import { HN_BRIEFING_PROMPT } from '../prompts/hackernews'

export interface ToolContext {
  uid: string
  conversationId: string
  emitProgress: (message: string) => void
}

interface ToolDefinition {
  declaration: FunctionDeclaration
  execute: (ctx: ToolContext, args: unknown) => Promise<unknown>
}

export const SUGGEST_OPTIONS_TOOL_NAME = 'suggest_options'

// Handled inside the AI provider (its items are streamed to the client),
// so it has no execute entry in the registry below.
const suggestOptionsDeclaration: FunctionDeclaration = {
  name: SUGGEST_OPTIONS_TOOL_NAME,
  description:
    'Call at the end of your response to suggest next steps or options for the user to choose from as buttons.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      items: {
        type: SchemaType.ARRAY,
        items: { type: SchemaType.STRING },
        description: '2 to 4 short button labels',
      },
    },
    required: ['items'],
  },
}

const toolDefinitions: ToolDefinition[] = [
  {
    declaration: {
      name: 'save_english_mistake',
      description:
        "Save an English learning point when the user's message contains a grammar mistake, unnatural phrasing, wrong preposition, article error, or word choice issue worth reviewing later — OR when the message is grammatically correct but a native speaker would naturally phrase it differently. Only call for genuinely valuable learning points — skip trivial typos or very minor issues.",
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          originalText: {
            type: SchemaType.STRING,
            description: "The user's original phrasing",
          },
          correctedText: {
            type: SchemaType.STRING,
            description: 'The improved, natural English version',
          },
          category: {
            type: SchemaType.STRING,
            description: 'One of: grammar, word-choice, preposition, article, phrasing',
          },
          severity: {
            type: SchemaType.STRING,
            description: 'One of: low, medium, high',
          },
          patternKey: {
            type: SchemaType.STRING,
            description: 'A reusable snake_case pattern identifier, e.g. by_gerund_for_method',
          },
          type: {
            type: SchemaType.STRING,
            description:
              '"mistake" if the original was grammatically wrong, "suggestion" if it was already correct but could sound more natural',
          },
        },
        required: ['originalText', 'correctedText', 'category', 'severity', 'patternKey', 'type'],
      },
    },
    execute: async (ctx, args) => {
      await db.saveEnglishMistake(ctx.uid, ctx.conversationId, args as EnglishMistakeData)
      ctx.emitProgress('Saving learning point...')
      return { result: 'saved' }
    },
  },
  {
    declaration: {
      name: 'get_english_mistakes',
      description:
        'Fetch the user\'s saved English learning points from the database. Call this when the user asks to review their mistakes, e.g. "show me today\'s mistakes" or "review my grammar errors this week".',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          startDate: {
            type: SchemaType.STRING,
            description: 'ISO date string (YYYY-MM-DD) for the start of the date range, inclusive',
          },
          endDate: {
            type: SchemaType.STRING,
            description: 'ISO date string (YYYY-MM-DD) for the end of the date range, inclusive',
          },
          category: {
            type: SchemaType.STRING,
            description:
              'Filter by category: grammar, word-choice, preposition, article, or phrasing',
          },
        },
        required: [],
      },
    },
    execute: async (ctx, args) => {
      ctx.emitProgress('Fetching your mistakes...')
      const mistakes = await db.listEnglishMistakes(ctx.uid, args as GetMistakesParams)
      return { mistakes }
    },
  },
  {
    declaration: {
      name: 'get_hacker_news_briefing',
      description:
        'Fetch the current Hacker News front page and render a "Morning Coffee Briefing". Call when the user asks for HN news, a morning briefing, or a tech news digest.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {},
        required: [],
      },
    },
    execute: async (ctx) => {
      ctx.emitProgress('Fetching Hacker News front page...')
      const stories = await getHNStories()
      return { stories, format_instructions: HN_BRIEFING_PROMPT }
    },
  },
]

export const chatFunctionDeclarations: FunctionDeclaration[] = [
  suggestOptionsDeclaration,
  ...toolDefinitions.map((t) => t.declaration),
]

export function createFunctionExecutor(ctx: ToolContext): FunctionExecutor {
  return async (name, args) => {
    const tool = toolDefinitions.find((t) => t.declaration.name === name)
    if (!tool) return { error: 'unknown function' }
    return tool.execute(ctx, args)
  }
}
