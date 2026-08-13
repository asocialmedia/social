import { debugLog } from "@asm/config/debug";
import { useMutation } from "@tanstack/react-query";

// Views are high-frequency and per-post, so firing one POST per post in the
// feed produced a burst of requests on every page load. Instead accumulate
// post ids client-side and flush them in a single batched request after a
// short debounce. The server still dedupes per (user, post), so nothing is
// double-counted.
const FLUSH_DELAY_MS = 800;
const MAX_BATCH = 100;

const pendingViews = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

async function flushViews(): Promise<void> {
  flushTimer = null;
  const postIds = [...pendingViews];
  pendingViews.clear();

  if (postIds.length === 0) {
    return;
  }

  debugLog.views(`Flushing ${postIds.length} view increments in one request`);
  try {
    await fetch("/api/views/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postIds }),
    });
  } catch (error) {
    debugLog.views("Failed to batch increment views:", error);
  }
}

function scheduleFlush(): void {
  if (flushTimer) {
    return;
  }
  flushTimer = setTimeout(() => {
    flushViews().catch((error: unknown) => {
      debugLog.views("Failed to flush view increments:", error);
    });
  }, FLUSH_DELAY_MS);
}

export function useIncrementViewMutation() {
  return useMutation({
    mutationFn: (postId: string) => {
      debugLog.views(`Queuing view increment for post: ${postId}`);
      pendingViews.add(postId);

      if (pendingViews.size >= MAX_BATCH) {
        flushViews().catch((error: unknown) => {
          debugLog.views("Failed to flush view increments:", error);
        });
      } else {
        scheduleFlush();
      }

      return Promise.resolve({ queued: true, postId });
    },
    retry: false,
  });
}
