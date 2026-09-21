import { metrics, trace } from "@opentelemetry/api";
import type { Context } from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  LoggerProvider,
  SimpleLogRecordProcessor,
} from "@opentelemetry/sdk-logs";
import {
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import type {
  ReadableSpan,
  Span,
  SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";

import {
  buildOpenObserveAuth,
  getOtlpEndpoints,
  readOtelConfig,
} from "./otel-config";
import type { OtelConfig } from "./otel-config";

// Container health probes hit /api/health every 30s per replica. Next traces
// each one into a full request span, so four health-check spans a minute per
// container swamped the trace stream with zero diagnostic value. Dropping them
// at the span processor removes the volume before it reaches the wire without
// touching application instrumentation.
const DEFAULT_DROP_SPAN_PATTERNS = ["/api/health"];

function readDropSpanPatterns(): string[] {
  const configured = process.env.OTEL_DROP_SPAN_PATTERNS;
  const patterns =
    configured === undefined
      ? DEFAULT_DROP_SPAN_PATTERNS
      : configured.split(",");
  return patterns
    .map((pattern) => pattern.trim().toLowerCase())
    .filter((pattern) => pattern.length > 0);
}

// Span attributes that can carry the request path/route, across Next.js's own
// span naming and the semantic conventions.
const SPAN_PATH_ATTRIBUTES = [
  "http.route",
  "http.target",
  "http.url",
  "next.route",
  "next.span_name",
] as const;

export function shouldDropSpan(
  span: ReadableSpan,
  patterns: string[]
): boolean {
  if (patterns.length === 0) {
    return false;
  }
  const attributes = span.attributes ?? {};
  const parts: string[] = [span.name];
  for (const key of SPAN_PATH_ATTRIBUTES) {
    const value = attributes[key];
    if (typeof value === "string") {
      parts.push(value);
    }
  }
  const haystack = parts.join(" ").toLowerCase();
  return patterns.some((pattern) => haystack.includes(pattern));
}

// Wraps a span processor and drops matching spans on end. `onStart` is a no-op
// on BatchSpanProcessor, so filtering on end is sufficient to keep a span out
// of the export buffer entirely.
class DroppingSpanProcessor implements SpanProcessor {
  readonly #inner: SpanProcessor;
  readonly #patterns: string[];

  constructor(inner: SpanProcessor, patterns: string[]) {
    this.#inner = inner;
    this.#patterns = patterns;
  }

  onStart(span: Span, parentContext: Context): void {
    this.#inner.onStart(span, parentContext);
  }

  onEnd(span: ReadableSpan): void {
    if (!shouldDropSpan(span, this.#patterns)) {
      this.#inner.onEnd(span);
    }
  }

  shutdown(): Promise<void> {
    return this.#inner.shutdown();
  }

  forceFlush(): Promise<void> {
    return this.#inner.forceFlush();
  }
}

export interface Telemetry {
  shutdown: () => Promise<void>;
  tracerProvider: NodeTracerProvider | null;
}

function buildHeaders(
  config: OtelConfig,
  stream: string | undefined
): Record<string, string> {
  const headers = { ...config.headers };
  if (stream) {
    headers["stream-name"] = stream;
  }
  return headers;
}

function buildStreamHeader(config: OtelConfig): Record<string, string> {
  const headers: Record<string, string> = {};
  if (config.logStreamName) {
    headers["stream-name"] = config.logStreamName;
  }
  return headers;
}

// Configures OpenTelemetry for traces, metrics and logs and exports them to
// OpenObserve over OTLP/HTTP. Should be called before any other module that
// creates spans/metrics. Returns handles to shut down gracefully.
export function initTelemetry(options: {
  serviceName: string;
  version?: string;
  traceEndpoint?: string;
  metricEndpoint?: string;
  logEndpoint?: string;
}): Telemetry {
  const config = readOtelConfig();

  if (!config.enabled) {
    return {
      shutdown: () => Promise.resolve(),
      tracerProvider: null,
    };
  }

  const serviceName = config.serviceName ?? options.serviceName;
  const resourceAttributes: Record<string, string> = {
    [ATTR_SERVICE_NAME]: serviceName,
  };
  if (options.version) {
    resourceAttributes[ATTR_SERVICE_VERSION] = options.version;
  }
  const resource = resourceFromAttributes(resourceAttributes);

  const endpoints = getOtlpEndpoints();
  const traceEndpoint = options.traceEndpoint ?? endpoints.traces;
  const metricEndpoint = options.metricEndpoint ?? endpoints.metrics;
  const logEndpoint = options.logEndpoint ?? endpoints.logs;

  const auth = buildOpenObserveAuth();
  const baseHeaders: Record<string, string> = auth
    ? { Authorization: auth }
    : {};

  const traceExporter = new OTLPTraceExporter({
    headers: {
      ...baseHeaders,
      ...buildHeaders(config, config.traceStreamName),
    },
    url: traceEndpoint,
  });

  const metricExporter = new OTLPMetricExporter({
    headers: {
      ...baseHeaders,
      ...buildHeaders(config, config.metricStreamName),
    },
    url: metricEndpoint,
  });

  const logExporter = new OTLPLogExporter({
    headers: { ...baseHeaders, ...buildStreamHeader(config) },
    url: logEndpoint,
  });

  const tracerProvider = new NodeTracerProvider({
    resource,
    spanProcessors: [
      new DroppingSpanProcessor(
        new BatchSpanProcessor(traceExporter),
        readDropSpanPatterns()
      ),
    ],
  });
  tracerProvider.register();

  const meterProvider = new MeterProvider({
    readers: [
      new PeriodicExportingMetricReader({
        exportIntervalMillis: 60_000,
        exporter: metricExporter,
      }),
    ],
    resource,
  });
  metrics.setGlobalMeterProvider(meterProvider);

  const loggerProvider = new LoggerProvider({
    processors: [new SimpleLogRecordProcessor({ exporter: logExporter })],
    resource,
  });
  logs.setGlobalLoggerProvider(loggerProvider);

  return {
    shutdown: async () => {
      await tracerProvider.shutdown();
      await meterProvider.shutdown();
      await loggerProvider.shutdown();
    },
    tracerProvider,
  };
}

// Returns the tracer and meter for manual instrumentation.
export function getTelemetryApi() {
  return {
    meter: metrics.getMeter("asm", "1.0.0"),
    tracer: trace.getTracer("asm", "1.0.0"),
  };
}
