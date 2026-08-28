import { createLogger, getTelemetryApi } from "@asm/logger";
import { SpanStatusCode } from "@opentelemetry/api";
import type { Attributes } from "@opentelemetry/api";

// Structured logger + OTel span helper for the media worker, mirroring the
// apps/auth worker conventions. Safe before initTelemetry: an unregistered
// tracer records spans to a no-op provider.

export const mediaLogger = createLogger({ serviceName: "media-processing" });

const { tracer } = getTelemetryApi();

export async function withSpan<T>(
  name: string,
  fn: () => Promise<T>,
  attributes: Attributes = {}
): Promise<T> {
  const span = tracer.startSpan(name, { attributes });
  try {
    const result = await fn();
    span.end();
    return result;
  } catch (error) {
    span.recordException(
      error instanceof Error ? error : new Error(String(error))
    );
    span.setStatus({ code: SpanStatusCode.ERROR });
    span.end();
    throw error;
  }
}
