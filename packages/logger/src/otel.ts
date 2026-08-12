import { metrics, trace } from "@opentelemetry/api";
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
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import {
  buildOpenObserveAuth,
  getOtlpEndpoints,
  type OtelConfig,
  readOtelConfig,
} from "./otel-config";

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
    return { tracerProvider: null, shutdown: async () => undefined };
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
    url: traceEndpoint,
    headers: {
      ...baseHeaders,
      ...buildHeaders(config, config.traceStreamName),
    },
  });

  const metricExporter = new OTLPMetricExporter({
    url: metricEndpoint,
    headers: {
      ...baseHeaders,
      ...buildHeaders(config, config.metricStreamName),
    },
  });

  const logExporter = new OTLPLogExporter({
    url: logEndpoint,
    headers: { ...baseHeaders, ...buildStreamHeader(config) },
  });

  const tracerProvider = new NodeTracerProvider({
    resource,
    spanProcessors: [new BatchSpanProcessor(traceExporter)],
  });
  tracerProvider.register();

  const meterProvider = new MeterProvider({
    resource,
    readers: [
      new PeriodicExportingMetricReader({
        exporter: metricExporter,
        exportIntervalMillis: 60_000,
      }),
    ],
  });
  metrics.setGlobalMeterProvider(meterProvider);

  const loggerProvider = new LoggerProvider({
    resource,
    processors: [new SimpleLogRecordProcessor({ exporter: logExporter })],
  });
  logs.setGlobalLoggerProvider(loggerProvider);

  return {
    tracerProvider,
    shutdown: async () => {
      await tracerProvider.shutdown();
      await meterProvider.shutdown();
      await loggerProvider.shutdown();
    },
  };
}

// Returns the tracer and meter for manual instrumentation.
export function getTelemetryApi() {
  return {
    tracer: trace.getTracer("asm", "1.0.0"),
    meter: metrics.getMeter("asm", "1.0.0"),
  };
}
