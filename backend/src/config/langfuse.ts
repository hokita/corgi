import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node'
import { LangfuseSpanProcessor } from '@langfuse/otel'

let provider: NodeTracerProvider | undefined
let spanProcessor: LangfuseSpanProcessor | undefined

export function initLangfuse(): void {
  if (!process.env.LANGFUSE_PUBLIC_KEY || !process.env.LANGFUSE_SECRET_KEY) return
  spanProcessor = new LangfuseSpanProcessor()
  provider = new NodeTracerProvider({ spanProcessors: [spanProcessor] })
  provider.register()
}

export async function flushLangfuse(): Promise<void> {
  await spanProcessor?.forceFlush()
}

export async function shutdownLangfuse(): Promise<void> {
  await provider?.shutdown()
}

export interface GeminiUsageMetadata {
  promptTokenCount?: number
  candidatesTokenCount?: number
  thoughtsTokenCount?: number
  totalTokenCount?: number
}

export function toUsageDetails(usage?: GeminiUsageMetadata): Record<string, number> | undefined {
  if (!usage) return undefined
  const details: Record<string, number> = {}
  if (usage.promptTokenCount !== undefined) details.input = usage.promptTokenCount
  if (usage.candidatesTokenCount !== undefined) details.output = usage.candidatesTokenCount
  if (usage.thoughtsTokenCount !== undefined) details.reasoning = usage.thoughtsTokenCount
  if (usage.totalTokenCount !== undefined) details.total = usage.totalTokenCount
  return Object.keys(details).length > 0 ? details : undefined
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function toTraceValue(value: unknown): string {
  return JSON.stringify(value)
}
