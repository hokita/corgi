import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node'
import { LangfuseSpanProcessor } from '@langfuse/otel'

let provider: NodeTracerProvider | undefined
let spanProcessor: LangfuseSpanProcessor | undefined

// Reads LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY / LANGFUSE_BASE_URL /
// LANGFUSE_TRACING_ENVIRONMENT from the environment. Without keys nothing is
// registered, so every tracing call in the app is a silent no-op.
// NodeTracerProvider is used instead of NodeSDK to avoid pulling in the full
// exporter zoo (gRPC/protobufjs/metrics) and default resource detectors that
// export host/process metadata with every span — dead weight on Cloud Run.
export function initLangfuse(): void {
  if (!process.env.LANGFUSE_PUBLIC_KEY || !process.env.LANGFUSE_SECRET_KEY) return
  spanProcessor = new LangfuseSpanProcessor()
  provider = new NodeTracerProvider({ spanProcessors: [spanProcessor] })
  // .register() installs the global tracer provider AND the AsyncLocalStorage
  // context manager — both required for context propagation.
  provider.register()
}

// Cloud Run throttles CPU once a response ends, so pending spans must be
// flushed while the request is still open.
export async function flushLangfuse(): Promise<void> {
  await spanProcessor?.forceFlush()
}

export async function shutdownLangfuse(): Promise<void> {
  await provider?.shutdown()
}

// Subset of Gemini's UsageMetadata; thoughtsTokenCount exists at runtime on
// thinking models but is missing from the legacy SDK's type.
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

// The Langfuse SDK JSON-encodes objects but passes strings through raw.
// Pre-encoding everything keeps span attributes uniformly JSON, so they
// parse the same way in tests and in the Langfuse UI.
export function toTraceValue(value: unknown): string {
  return JSON.stringify(value)
}
