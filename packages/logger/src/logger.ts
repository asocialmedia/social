import { trace } from "@opentelemetry/api";
import pino from "pino";
import pretty from "pino-pretty";
import { buildOpenObserveAuth, getOtlpEndpoints } from "./otel-config";
import { createOtlpLogDestination } from "./otlp-log-destination";

export type Logger = pino.Logger;

export interface LoggerOptions {
  level?: pino.LevelWithSilent | string;
  name?: string;
  otlpEndpoint?: string;
  otlpHeaders?: Record<string, string>;
  pretty?: boolean;
  serviceName?: string;
}

function parseOtlpHeaders(value: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  if (!value) {
    return headers;
  }
  for (const pair of value.split(",")) {
    const [key, ...rest] = pair.split("=");
    if (key) {
      headers[key.trim()] = rest.join("=").trim();
    }
  }
  return headers;
}

function bindTraceContext(): Record<string, unknown> {
  try {
    const span = trace.getActiveSpan();
    if (!span) {
      return {};
    }
    const spanContext = span.spanContext();
    return {
      trace_id: spanContext.traceId,
      span_id: spanContext.spanId,
      trace_flags: spanContext.traceFlags,
    };
  } catch {
    return {};
  }
}

function buildStreams(options: LoggerOptions): pino.DestinationStream[] {
  const streams: pino.DestinationStream[] = [];

  if (options.otlpEndpoint) {
    streams.push(
      createOtlpLogDestination({
        endpoint: options.otlpEndpoint,
        headers: options.otlpHeaders ?? {},
        serviceName: options.serviceName,
      })
    );
  }

  if (options.pretty) {
    streams.push(
      pretty({
        colorize: true,
        translateTime: "SYS:HH:MM:ss.l",
        ignore: "pid,hostname",
      })
    );
  } else {
    streams.push(pino.destination(1));
  }

  return streams;
}

// Creates a pino logger. In production, logs are streamed to stdout as JSON
// and optionally shipped to OpenObserve via an OTLP destination. In dev the
// output is human-readable via pino-pretty.
export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? process.env.LOG_LEVEL ?? "info";

  const endpoints = getOtlpEndpoints();
  const endpoint =
    options.otlpEndpoint ??
    process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT ??
    process.env.OPENOBSERVE_LOGS_ENDPOINT ??
    endpoints.logs;

  const auth = buildOpenObserveAuth();
  const resolved: LoggerOptions = {
    ...options,
    otlpEndpoint: endpoint,
    otlpHeaders: {
      ...(auth ? { Authorization: auth } : {}),
      ...parseOtlpHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS),
      ...options.otlpHeaders,
    },
    pretty: options.pretty ?? process.env.NODE_ENV === "development",
  };

  const serviceName = resolved.serviceName ?? "app";

  const streams = buildStreams(resolved);
  const destination =
    streams.length === 1 ? streams[0] : pino.multistream(streams);

  return pino(
    {
      name: resolved.name ?? serviceName,
      level: level as pino.Level,
      base: { service: serviceName },
      formatters: {
        log(object) {
          return { ...object, ...bindTraceContext() };
        },
      },
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    destination
  );
}

// Default logger instance for the auth service.
export const logger = createLogger({ serviceName: "auth" });
