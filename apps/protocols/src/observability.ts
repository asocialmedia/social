import { ProtocolError } from "@asm/protocols/contracts";
import type { ProtocolObserver } from "@asm/protocols/contracts";
import {
  context,
  metrics,
  propagation,
  SpanStatusCode,
  trace,
} from "@opentelemetry/api";

export interface ProtocolLogger {
  debug: (fields: Record<string, unknown>, message: string) => void;
  info: (fields: Record<string, unknown>, message: string) => void;
  warn: (fields: Record<string, unknown>, message: string) => void;
  error: (fields: Record<string, unknown>, message: string) => void;
}

const meter = metrics.getMeter("asm-protocols");
const upstreamDuration = meter.createHistogram(
  "asm.protocols.upstream.duration",
  { unit: "ms" }
);
const upstreamRequests = meter.createCounter("asm.protocols.upstream.requests");
const requestDuration = meter.createHistogram(
  "asm.protocols.request.duration",
  { unit: "ms" }
);

export function createProtocolObserver(
  logger: ProtocolLogger
): ProtocolObserver {
  return (diagnostic) => {
    const attributes = {
      operation: diagnostic.operation,
      outcome: diagnostic.outcome,
      source: "bluesky",
    };
    upstreamDuration.record(diagnostic.durationMs, attributes);
    upstreamRequests.add(1, attributes);
    const fields = { ...diagnostic, source: "bluesky" };
    if (diagnostic.outcome === "error") {
      logger.warn(fields, "Protocol upstream request failed");
    } else {
      logger.debug(fields, "Protocol upstream request completed");
    }
  };
}

export function requestId(request: Request): string {
  const supplied = request.headers.get("x-request-id");
  return supplied && /^[A-Za-z0-9._-]{1,96}$/.test(supplied)
    ? supplied
    : crypto.randomUUID();
}

export function observeRequest<T>(
  operation: string,
  request: Request,
  id: string,
  logger: ProtocolLogger,
  read: () => Promise<T>
): Promise<T> {
  const parent = propagation.extract(context.active(), request.headers, {
    get: (headers, key) => headers.get(key) ?? undefined,
    keys: (headers) => [...headers.keys()],
  });
  const tracer = trace.getTracer("asm-protocols");
  const startedAt = performance.now();
  return tracer.startActiveSpan(
    operation,
    {
      attributes: {
        "asm.request.id": id,
        "http.request.method": request.method,
      },
    },
    parent,
    async (span) => {
      const spanContext = span.spanContext();
      const correlation = {
        operation,
        requestId: id,
        span_id: spanContext.spanId,
        trace_id: spanContext.traceId,
      };
      try {
        const result = await read();
        span.setStatus({ code: SpanStatusCode.OK });
        logger.info(
          { ...correlation, durationMs: performance.now() - startedAt },
          "Protocol request completed"
        );
        return result;
      } catch (error) {
        const code = error instanceof ProtocolError ? error.code : "internal";
        span.setStatus({ code: SpanStatusCode.ERROR, message: code });
        logger.warn(
          { ...correlation, code, durationMs: performance.now() - startedAt },
          "Protocol request failed"
        );
        throw error;
      } finally {
        requestDuration.record(performance.now() - startedAt, { operation });
        span.end();
      }
    }
  );
}
