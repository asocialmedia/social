import { createLogger } from "@asm/logger";

const logger = createLogger({ serviceName: "recommendation-health" });
const status = new Map<string, { failed: boolean; loggedAt: number }>();

// One warning per source per minute prevents an upstream outage from flooding logs under load.
export function reportRecommendationHealth(
  source: "native-feed" | "suggestions" | "bluesky-suggestions",
  healthy: boolean,
  error?: unknown
) {
  const previous = status.get(source);
  const now = Date.now();
  if (healthy) {
    if (previous?.failed) {
      logger.info({ source }, "Recommendation source recovered");
    }
    status.set(source, { failed: false, loggedAt: previous?.loggedAt ?? 0 });
  } else if (
    !previous ||
    !previous.failed ||
    now - previous.loggedAt >= 60_000
  ) {
    logger.warn(
      { error, source },
      "Recommendation source unavailable; retaining independent source results"
    );
    status.set(source, { failed: true, loggedAt: now });
  }
}
