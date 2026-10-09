import { getTelemetryApi } from "@asm/logger";

import type { MessageSearchClientMetric } from "./search-client-metric-contract";

interface MessageSearchClientHistogram {
  record: (
    value: number,
    attributes: { event: MessageSearchClientMetric["event"]; outcome?: string }
  ) => void;
}

type CreateMessageSearchClientHistogram = (
  name: string,
  options: { description: string; unit: "ms" }
) => MessageSearchClientHistogram;

function createTelemetryHistogram(
  name: string,
  options: { description: string; unit: "ms" }
): MessageSearchClientHistogram {
  return getTelemetryApi().meter.createHistogram(name, options);
}

export function createMessageSearchClientMetricRecorder(
  createHistogram: CreateMessageSearchClientHistogram = createTelemetryHistogram
): (events: readonly MessageSearchClientMetric[]) => void {
  let histogram: MessageSearchClientHistogram | null = null;
  return (events) => {
    try {
      histogram ??= createHistogram("messages.search.client.duration", {
        description:
          "Sampled DM search responsiveness and transcript scroll frame intervals",
        unit: "ms",
      });
      for (const event of events) {
        histogram.record(event.durationMs, {
          event: event.event,
          ...(event.event === "result-ready" ? { outcome: event.outcome } : {}),
        });
      }
    } catch {
      // Telemetry must not change search behavior.
    }
  };
}

export const recordMessageSearchClientMetrics =
  createMessageSearchClientMetricRecorder();
