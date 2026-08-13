import { createLogger, getTelemetryApi } from "@asm/logger";
import { type Attributes, SpanStatusCode } from "@opentelemetry/api";

// Minimal logger surface used across the worker modules so they can emit
// structured logs (pino + trace context) instead of console.*. The entrypoint
// passes the real pino logger; tests may pass nothing and get the no-op.
export interface WorkerLogger {
  debug: (obj: Record<string, unknown>, msg?: string) => void;
  error: (obj: Record<string, unknown>, msg?: string) => void;
  info: (obj: Record<string, unknown>, msg?: string) => void;
  warn: (obj: Record<string, unknown>, msg?: string) => void;
}

export const workerLogger = createLogger({ serviceName: "worker" });

const noopLogger: WorkerLogger = {
  debug: () => undefined,
  error: () => undefined,
  info: () => undefined,
  warn: () => undefined,
};

export function resolveLogger(logger?: WorkerLogger): WorkerLogger {
  return logger ?? noopLogger;
}

const { tracer } = getTelemetryApi();

// Runs `fn` inside a named OpenTelemetry span, recording exceptions and
// status. Safe to call before initTelemetry: an unregistered tracer records
// spans to a no-op provider, so tests do not need telemetry wiring.
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
