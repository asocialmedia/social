import { createLogger } from "@asm/logger";

const logger = createLogger({ serviceName: "recommendation-health" });
const status = new Map<string, { failed: boolean; loggedAt: number }>();

// One warning per source per minute prevents an upstream outage from flooding logs under load.
export function reportRecommendationHealth(
  source: "native-feed" | "suggestions" | "bluesky-suggestions",
  healthy: boolean,
  error?: unknown,
  signal?: AbortSignal
) {
  if (signal?.aborted) {
    return;
  }
  const previous = status.get(source);
  const now = Date.now();
  if (healthy) {
    if (previous?.failed) {
      logger.info({ source }, "Recommendation source recovered");
    }
    status.set(source, { failed: false, loggedAt: previous?.loggedAt ?? 0 });
  } else if (!previous || now - previous.loggedAt >= 60_000) {
    // Preserve the cause without leaking response payloads.
    let detail: string | undefined;
    if (error instanceof Error) {
      detail = `${error.name}: ${error.message}`.slice(0, 300);
    } else if (typeof error === "string") {
      detail = error.slice(0, 300);
    }
    logger.warn(
      { error: detail, source },
      "Recommendation source unavailable; retaining independent source results"
    );
    status.set(source, { failed: true, loggedAt: now });
  }
}
