import { SeverityNumber } from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BatchLogRecordProcessor,
  LoggerProvider,
} from "@opentelemetry/sdk-logs";

type LogAttributes = Record<string, string | number | boolean>;

export function createClassifierTelemetry(
  env: Record<string, string | undefined>
) {
  const service = env.OTEL_SERVICE_NAME ?? "classifier";
  const organization = env.OPENOBSERVE_ORG ?? "default";
  const stream = env.OPENOBSERVE_LOG_STREAM ?? "asm_classifier_logs";
  const headers: Record<string, string> = { "stream-name": stream };
  for (const pair of (env.OTEL_EXPORTER_OTLP_HEADERS ?? "").split(",")) {
    const separator = pair.indexOf("=");
    if (separator > 0) {
      headers[pair.slice(0, separator).trim()] = pair
        .slice(separator + 1)
        .trim();
    }
  }
  if (env.OPENOBSERVE_USER && env.OPENOBSERVE_PASSWORD) {
    headers.Authorization = `Basic ${Buffer.from(`${env.OPENOBSERVE_USER}:${env.OPENOBSERVE_PASSWORD}`).toString("base64")}`;
  }
  let provider: LoggerProvider | undefined;
  const base = env.OTEL_EXPORTER_OTLP_ENDPOINT?.replace(/\/+$/, "");
  const endpoint =
    env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT ??
    (base
      ? `${base.includes("/api/") ? base : `${base}/api/${organization}`}${base.endsWith("/v1/logs") ? "" : "/v1/logs"}`
      : undefined);
  if (endpoint && env.OTEL_SDK_DISABLED !== "true") {
    try {
      const exporter = new OTLPLogExporter({
        concurrencyLimit: 1,
        headers,
        timeoutMillis: 3000,
        url: endpoint,
      });
      provider = new LoggerProvider({
        processors: [
          new BatchLogRecordProcessor({
            exportTimeoutMillis: 3500,
            exporter,
            maxExportBatchSize: 64,
            maxQueueSize: 512,
            scheduledDelayMillis: 2000,
          }),
        ],
        resource: resourceFromAttributes({
          "deployment.environment.name": env.NODE_ENV ?? "development",
          "service.name": service,
        }),
      });
    } catch {
      process.stderr.write(
        "Classifier log export configuration unavailable; stdout logging continues.\n"
      );
    }
  }
  const logger = provider?.getLogger("asm-classifier");
  const log = (
    level: "info" | "warn" | "error",
    event: string,
    attributes: LogAttributes = {}
  ) => {
    process.stdout.write(
      `${JSON.stringify({ event, level, service, time: new Date().toISOString(), ...attributes })}\n`
    );
    logger?.emit({
      attributes,
      body: event,
      severityNumber: {
        error: SeverityNumber.ERROR,
        info: SeverityNumber.INFO,
        warn: SeverityNumber.WARN,
      }[level],
      severityText: level.toUpperCase(),
    });
  };
  return {
    async flush() {
      try {
        await provider?.forceFlush();
      } catch {
        process.stderr.write(
          "Classifier log export unavailable; stdout logging continues.\n"
        );
      }
    },
    log,
    async shutdown() {
      try {
        await provider?.shutdown();
      } catch {
        process.stderr.write(
          "Classifier log export shutdown unavailable; stdout logging continues.\n"
        );
      }
    },
  };
}
