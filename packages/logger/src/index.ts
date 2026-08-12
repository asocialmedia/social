// biome-ignore-all lint/performance/noBarrelFile: logger package is intentionally small

export {
  createLogger,
  type Logger,
  type LoggerOptions,
  logger,
} from "./logger";
export {
  getTelemetryApi,
  initTelemetry,
  type Telemetry,
} from "./otel";
export {
  enableOtelDiagnostics,
  type OtelConfig,
  readOtelConfig,
} from "./otel-config";
export { createOtlpLogDestination } from "./otlp-log-destination";
