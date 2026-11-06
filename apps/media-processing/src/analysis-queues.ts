import type { Queue } from "bullmq";

type AnalysisQueue = Pick<Queue, "setGlobalConcurrency" | "setGlobalRateLimit">;

export async function configureAnalysisQueues(queues: {
  analyze: AnalysisQueue;
  externalSafety: AnalysisQueue;
}): Promise<void> {
  // Limits are stored in Redis and apply across all media-worker replicas.
  await queues.analyze.setGlobalConcurrency(1);
  await queues.externalSafety.setGlobalConcurrency(1);
  // Each safety job admits at most four images to the classifier's eight-slot queue.
  await queues.externalSafety.setGlobalRateLimit(2, 1000);
}
