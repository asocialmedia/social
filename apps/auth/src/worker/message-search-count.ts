import {
  claimMessageSearchCountRequest,
  completeMessageSearchCountRequest,
  countMessageSearchCandidates,
  releaseMessageSearchCountRequest,
} from "@asm/db";

import type { MessageSearchWorkerMetricSink } from "./message-search-metrics";
import { safelyRecordMessageSearchWorkerMetric } from "./message-search-metrics";

export async function processMessageSearchCount(
  requestId: string,
  logger: {
    error: (fields: Record<string, unknown>, message: string) => void;
  },
  metrics?: MessageSearchWorkerMetricSink
): Promise<void> {
  const startedAt = performance.now();
  let outcome: "completed" | "retry" | "skipped" = "retry";
  let claimedRequestId: string | null = null;
  try {
    const request = await claimMessageSearchCountRequest(requestId);
    if (!request) {
      outcome = "skipped";
      return;
    }
    claimedRequestId = request.id;
    const exactCount = await countMessageSearchCandidates({
      conversationId: request.conversationId,
      fragments: request.fragments,
      membershipWindows: request.membershipWindows,
      snapshotSequence: request.snapshotSequence,
      userId: request.userId,
    });
    await completeMessageSearchCountRequest(request.id, exactCount);
    outcome = "completed";
  } catch (error) {
    if (claimedRequestId) {
      await releaseMessageSearchCountRequest(claimedRequestId).catch(
        () => null
      );
    }
    logger.error({ requestId }, "DM search count processing failed");
    throw error;
  } finally {
    safelyRecordMessageSearchWorkerMetric(metrics, {
      durationMs: performance.now() - startedAt,
      job: "count",
      outcome,
    });
  }
}
