// The logger surface the push transports accept. Kept in its own module so
// dispatch.ts, fcm.ts and web-push.ts can all reference it without a cycle.
//
// This mirrors the worker's pino logger, whose records already carry the active
// OTEL trace_id/span_id automatically (packages/logger), so every push log line
// correlates with the `job.notification-created` span without extra wiring.
export interface PushLogger {
  error: (message: string, meta?: Record<string, unknown>) => void;
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
}

// Reduces a push service's error to safe, useful fields. Tokens, subscription
// endpoints and keys are credentials: they must never reach a log line, so only
// the status code and a short reason are returned.
export function describePushError(error?: unknown): {
  reason: string;
  status: number | null;
} {
  if (typeof error !== "object" || error === null) {
    return { reason: String(error).slice(0, 120), status: null };
  }
  const record = error as { message?: unknown; statusCode?: unknown };
  const status =
    typeof record.statusCode === "number" ? record.statusCode : null;
  const reason =
    typeof record.message === "string" && record.message.length > 0
      ? record.message.slice(0, 120)
      : "unknown";
  return { reason, status };
}

// Host only: a full push endpoint contains the subscription id, which is a
// capability to send to that device.
export function endpointHost(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return "invalid";
  }
}
