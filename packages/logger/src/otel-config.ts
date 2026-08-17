import { DiagConsoleLogger, DiagLogLevel, diag } from "@opentelemetry/api";

const TRAILING_SLASH_REGEX = /\/+$/;
const API_PATH_REGEX = /\/api\//;

export interface OtelConfig {
  enabled: boolean;
  endpoint: string | undefined;
  headers: Record<string, string>;
  logStreamName: string | undefined;
  metricStreamName: string | undefined;
  organization: string | undefined;
  serviceName: string | undefined;
  traceStreamName: string | undefined;
}

function base64Encode(value: string): string {
  return Buffer.from(value).toString("base64");
}

function buildAuthHeader(
  username: string | undefined,
  password: string | undefined
): Record<string, string> {
  if (username && password) {
    return {
      Authorization: `Basic ${base64Encode(`${username}:${password}`)}`,
    };
  }
  return {};
}

// Resolves the OpenObserve log stream a service should write to. Falls back
// to `default` (or `default_<service>` when a service name is known) so local
// setups without configuration still have a well-defined destination.
export function resolveLogStreamName(
  env: NodeJS.ProcessEnv = process.env
): string {
  return (
    env.OPENOBSERVE_LOG_STREAM ??
    env.OPENOBSERVE_STREAM ??
    env.ZO_STREAM ??
    (env.OTEL_SERVICE_NAME ? `default_${env.OTEL_SERVICE_NAME}` : "default")
  );
}

// Reads OpenObserve / OpenTelemetry settings from the environment. Uses the
// standard OTEL_* variables where possible and OpenObserve-specific ones for
// the ingestion stream names and organization.
export function readOtelConfig(
  env: NodeJS.ProcessEnv = process.env
): OtelConfig {
  const endpoint =
    env.OTEL_EXPORTER_OTLP_ENDPOINT ??
    env.OPENOBSERVE_ENDPOINT ??
    env.ZO_ENDPOINT ??
    "http://localhost:5080/api/default";

  const streamName = resolveLogStreamName(env);

  const headers: Record<string, string> = {};

  if (env.OTEL_EXPORTER_OTLP_HEADERS) {
    // OTEL headers come as comma-separated key=value pairs
    for (const pair of env.OTEL_EXPORTER_OTLP_HEADERS.split(",")) {
      const [key, ...rest] = pair.split("=");
      if (key) {
        headers[key.trim()] = rest.join("=").trim();
      }
    }
  }

  const user = env.OPENOBSERVE_USER ?? env.ZO_ROOT_USER_EMAIL ?? env.ZO_USER;
  const password =
    env.OPENOBSERVE_PASSWORD ??
    env.ZO_ROOT_USER_PASSWORD ??
    env.ZO_PASSWORD ??
    env.ZO_ADMIN_PASSWORD;

  Object.assign(headers, buildAuthHeader(user, password));

  const organization = env.ZO_ORGANIZATION ?? env.OPENOBSERVE_ORG;
  if (organization) {
    headers.organization = organization;
  }

  const enabled = env.OPENOBSERVE_ENABLED === "true" || env.NODE_ENV !== "test";

  return {
    enabled,
    endpoint,
    headers,
    logStreamName: env.OPENOBSERVE_LOG_STREAM ?? streamName,
    metricStreamName: env.OPENOBSERVE_METRIC_STREAM ?? streamName,
    organization,
    serviceName: env.OTEL_SERVICE_NAME,
    traceStreamName: env.OPENOBSERVE_TRACE_STREAM ?? streamName,
  };
}

// Enables OpenTelemetry diagnostics at a useful level while exporting.
export function enableOtelDiagnostics(): void {
  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.WARN);
}

function buildOrgBase(env: NodeJS.ProcessEnv = process.env): string {
  const raw =
    env.OTEL_EXPORTER_OTLP_ENDPOINT ??
    env.OPENOBSERVE_ENDPOINT ??
    env.ZO_ENDPOINT ??
    "http://localhost:5080/api/default";
  const trimmed = raw.replace(TRAILING_SLASH_REGEX, "");
  const org = env.ZO_ORGANIZATION ?? env.OPENOBSERVE_ORG ?? "default";
  if (API_PATH_REGEX.test(trimmed)) {
    return trimmed;
  }
  return `${trimmed}/api/${org}`;
}

function hasSuffix(url: string, suffix: string): boolean {
  return url.endsWith(`/${suffix}`) || url.endsWith(`/${suffix}/`);
}

// Builds the OTLP/HTTP endpoint URLs for logs, metrics and traces pointing at
// OpenObserve. A single base endpoint (OTEL_EXPORTER_OTLP_ENDPOINT) maps to
// the three signal endpoints under /api/<org>/.
export function getOtlpEndpoints(env: NodeJS.ProcessEnv = process.env): {
  logs: string;
  metrics: string;
  traces: string;
} {
  const logsOverride =
    env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT ?? env.OPENOBSERVE_LOGS_ENDPOINT;
  const metricsOverride =
    env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT ?? env.OPENOBSERVE_METRICS_ENDPOINT;
  const tracesOverride =
    env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ?? env.OPENOBSERVE_TRACES_ENDPOINT;

  const base = buildOrgBase(env);
  return {
    logs:
      logsOverride ?? (hasSuffix(base, "v1/logs") ? base : `${base}/v1/logs`),
    metrics:
      metricsOverride ??
      (hasSuffix(base, "v1/metrics") ? base : `${base}/v1/metrics`),
    traces:
      tracesOverride ??
      (hasSuffix(base, "v1/traces") ? base : `${base}/v1/traces`),
  };
}

// Builds the basic auth header value for OpenObserve ingestion.
export function buildOpenObserveAuth(
  env: NodeJS.ProcessEnv = process.env
): string | undefined {
  const user = env.OPENOBSERVE_USER ?? env.ZO_ROOT_USER_EMAIL ?? env.ZO_USER;
  const password =
    env.OPENOBSERVE_PASSWORD ??
    env.ZO_ROOT_USER_PASSWORD ??
    env.ZO_PASSWORD ??
    env.ZO_ADMIN_PASSWORD;
  if (user && password) {
    return `Basic ${base64Encode(`${user}:${password}`)}`;
  }
}
