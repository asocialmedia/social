// Mobile logging + OpenTelemetry. Same OTLP/HTTP schema as the backend
// (@asm/logger ships to OpenObserve), but @asm/logger is Node-only
// (sdk-node, pino streams, Buffer), so the app uses react-native-otel:
// zero native deps, OTLP/JSON over fetch, batched every 30s.
// Disabled unless EXPO_PUBLIC_OTEL_ENDPOINT is set — no endpoint means
// console in dev and a local no-op in prod. Never ships secrets: only a
// public ingestion token goes in EXPO_PUBLIC_OTEL_TOKEN, and even that is
// optional (self-hosted collectors often need no auth on a private net).
import Constants from "expo-constants";
import { OtlpHttpLogExporter, otel } from "react-native-otel";

type LogAttributes = Record<string, string | number | boolean>;

let telemetryStarted = false;

export function initTelemetry(): void {
  if (telemetryStarted) {
    return;
  }
  telemetryStarted = true;
  const endpoint = process.env.EXPO_PUBLIC_OTEL_ENDPOINT?.trim();
  if (!endpoint || __DEV__) {
    return;
  }
  try {
    const token = process.env.EXPO_PUBLIC_OTEL_TOKEN?.trim();
    otel.init({
      environment: "production",
      logExporter: new OtlpHttpLogExporter({
        endpoint,
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      }),
      sensitiveKeys: ["header.authorization", "header.cookie", "body.password"],
      serviceName: "asocialmedia-mobile",
      serviceVersion: Constants.expoConfig?.version ?? "0.0.0",
    });
  } catch {
    // Telemetry must never break the app.
  }
}

function emit(
  severity: "error" | "info" | "warn",
  message: string,
  attributes?: LogAttributes
): void {
  if (__DEV__) {
    const consoleFn = severity === "info" ? console.log : console[severity];
    consoleFn(`[${severity}] ${message}`, attributes ?? "");
    return;
  }
  try {
    otel.getLogger()[severity](message, attributes);
  } catch {
    // Telemetry must never break the app.
  }
}

export function logInfo(message: string, attributes?: LogAttributes): void {
  emit("info", message, attributes);
}

export function logWarn(message: string, attributes?: LogAttributes): void {
  emit("warn", message, attributes);
}

function toErrorAttributes(error: unknown): LogAttributes {
  if (error instanceof Error) {
    return { "error.message": error.message, "error.name": error.name };
  }
  return { "error.message": String(error) };
}

export function logError(
  message: string,
  error?: unknown,
  attributes?: LogAttributes
): void {
  emit("error", message, { ...attributes, ...toErrorAttributes(error) });
}
