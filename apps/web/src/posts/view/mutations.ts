import { debugLog } from "@asm/config/debug";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";

import { applyViewCountToCaches } from "@/lib/cache-sync";

// Views are high-frequency and per-post, so firing one POST per post in the
// feed produced a burst of requests on every page load. Instead accumulate
// post ids client-side and flush them in a single batched request after a
// short debounce. The server still dedupes per (user, post), so nothing is
// double-counted.
const FLUSH_DELAY_MS = 800;
const MAX_BATCH = 100;

const pendingViews = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

async function flushViews(queryClient: QueryClient | null): Promise<void> {
  flushTimer = null;
  const postIds = [...pendingViews];
  pendingViews.clear();

  if (postIds.length === 0) {
    return;
  }

  debugLog.views(`Flushing ${postIds.length} view increments in one request`);
  try {
    const response = await fetch("/api/views/batch", {
      body: JSON.stringify({ postIds }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      debugLog.views(`View flush failed with status ${response.status}`);
    }
    if (response.ok) {
      const body = (await response.json()) as {
        results?: Record<string, number>;
      };
      if (body.results && queryClient) {
        for (const [postId, count] of Object.entries(body.results)) {
          if (typeof count === "number") {
            applyViewCountToCaches(queryClient, postId, count);
          }
        }
      }
    }
  } catch (error) {
    debugLog.views("Failed to batch increment views:", error);
  }
}

function scheduleFlush(queryClient: QueryClient | null): void {
  if (flushTimer) {
    return;
  }
  flushTimer = setTimeout(() => {
    void flushViews(queryClient);
  }, FLUSH_DELAY_MS);
}

export function useIncrementViewMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (postId: string) => {
      debugLog.views(`Queuing view increment for post: ${postId}`);
      pendingViews.add(postId);

      if (pendingViews.size >= MAX_BATCH) {
        void flushViews(queryClient);
      } else {
        scheduleFlush(queryClient);
      }

      return Promise.resolve({ postId, queued: true });
    },
    retry: false,
  });
}
