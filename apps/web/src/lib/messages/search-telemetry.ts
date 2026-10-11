import { getTelemetryApi } from "@asm/logger";

export type MessageSearchApiRoute = "search";
export type MessageSearchApiOutcome = "success" | "unavailable";

export interface MessageSearchApiMetricEvent {
  durationMs: number;
  outcome: MessageSearchApiOutcome;
  route: MessageSearchApiRoute;
}

interface MessageSearchApiHistogram {
  record: (
    value: number,
    attributes: {
      outcome: MessageSearchApiOutcome;
      route: MessageSearchApiRoute;
    }
  ) => void;
}

type CreateMessageSearchApiHistogram = (
  name: string,
  options: { description: string; unit: "ms" }
) => MessageSearchApiHistogram;

function createTelemetryHistogram(
  name: string,
  options: { description: string; unit: "ms" }
): MessageSearchApiHistogram {
  return getTelemetryApi().meter.createHistogram(name, options);
}

export function createMessageSearchApiMetricRecorder(
  createHistogram: CreateMessageSearchApiHistogram = createTelemetryHistogram
): (event: MessageSearchApiMetricEvent) => void {
  let histogram: MessageSearchApiHistogram | null = null;
  return (event) => {
    try {
      histogram ??= createHistogram("messages.search.api.duration", {
        description: "DM search candidate query and response construction time",
        unit: "ms",
      });
      histogram.record(
        Number.isFinite(event.durationMs) ? Math.max(0, event.durationMs) : 0,
        { outcome: event.outcome, route: event.route }
      );
    } catch {
      // Telemetry must never change the search result or its failure behavior.
    }
  };
}

export const recordMessageSearchApiMetric =
  createMessageSearchApiMetricRecorder();
