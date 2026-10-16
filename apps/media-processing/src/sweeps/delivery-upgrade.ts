import { and, enqueueMediaProcess, MEDIA_PROCESS_QUEUE, prisma } from "@asm/db";
import { MEDIA_PIPELINE_VERSION } from "@asm/media";
import { Queue } from "bullmq";

import { workerEnv } from "../env";
import { mediaLogger } from "../log";

let cursor: string | undefined;
const lastQueued = new Map<string, number>();
const RETRY_DELAY_MS = 6 * 60 * 60 * 1000;

export function needsDeliveryUpgrade(metadata: unknown): boolean {
  return (
    !metadata ||
    typeof metadata !== "object" ||
    !("deliveryVersion" in metadata) ||
    metadata.deliveryVersion !== MEDIA_PIPELINE_VERSION
  );
}

// Scan the registered media corpus, not the bucket: RustFS also holds private
// quarantine and unrelated objects which must never become public media.
// Stable cursor pagination reaches old rows even when some cannot be decoded.
export async function deliveryUpgradeSweep(): Promise<{
  checked: number;
  enqueued: number;
}> {
  if (!workerEnv.BACKFILL_ENABLED) {
    return { checked: 0, enqueued: 0 };
  }
  const queue = new Queue(MEDIA_PROCESS_QUEUE, {
    connection: { maxRetriesPerRequest: null, url: workerEnv.REDIS_URL },
  });
  try {
    const counts = await queue.getJobCounts(
      "waiting",
      "active",
      "delayed",
      "prioritized"
    );
    const capacity = Math.max(
      0,
      20 - Object.values(counts).reduce((sum, count) => sum + count, 0)
    );
    if (capacity === 0) {
      return { checked: 0, enqueued: 0 };
    }
    const rows = await prisma.orm.public.PostMedia.select(
      "id",
      "techMetadata",
      "failureCode"
    )
      .where((media) =>
        and(
          ...(cursor ? [media.id.gt(cursor)] : []),
          media.status.eq("READY"),
          media.publishedKey.isNotNull(),
          media._type.in(["IMAGE", "VIDEO", "AUDIO"])
        )
      )
      .orderBy((media) => media.id.asc())
      .limit(20)
      .all();
    let enqueued = 0;
    const now = Date.now();
    for (const [id, timestamp] of lastQueued) {
      if (now - timestamp >= RETRY_DELAY_MS) {
        lastQueued.delete(id);
      }
    }
    for (const row of rows) {
      if (enqueued >= Math.min(5, capacity)) {
        break;
      }
      cursor = row.id;
      if (
        !needsDeliveryUpgrade(row.techMetadata) ||
        lastQueued.has(row.id) ||
        (row.failureCode && row.failureCode !== "encode-failed")
      ) {
        continue;
      }
      await enqueueMediaProcess(row.id, { backfill: true });
      lastQueued.set(row.id, now);
      enqueued += 1;
    }
    if (rows.length === 0) {
      cursor = undefined;
    }
    if (enqueued > 0) {
      mediaLogger.info(
        { enqueued, version: MEDIA_PIPELINE_VERSION },
        "delivery watcher queued existing media upgrades"
      );
    }
    return { checked: rows.length, enqueued };
  } finally {
    await queue.close();
  }
}
