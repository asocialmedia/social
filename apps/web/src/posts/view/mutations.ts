import { debugLog } from "@asm/config/debug";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

// Views are high-frequency and per-post, so firing one POST per post in the
// feed produced a burst of requests on every page load. Instead accumulate
// post ids client-side and flush them in a single batched request after a
// short debounce. The server still dedupes per (user, post), so nothing is
// double-counted.
const FLUSH_DELAY_MS = 800;
const MAX_BATCH = 100;

const pendingViews = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let queryClientRef: QueryClient | null = null;

// The batch route responds with the authoritative per-post view count. Walk
// every cached query's data and bump viewCount on any post object whose id is
// in the results, so feeds, gusts and explore show the new number without a
// page refresh.
function applyViewCounts(
  queryClient: QueryClient,
  results: Record<string, number>
): void {
  if (Object.keys(results).length === 0) {
    return;
  }
  queryClient.setQueriesData({ queryKey: [] }, (oldData) => {
    if (!oldData || typeof oldData !== "object") {
      return oldData;
    }
    return updatePostsDeep(oldData as Record<string, unknown>, results);
  });
}

function updatePostsDeep(
  node: unknown,
  results: Record<string, number>
): unknown {
  if (Array.isArray(node)) {
    let changed = false;
    const next = node.map((item) => {
      const updated = updatePostsDeep(item, results);
      if (updated !== item) {
        changed = true;
      }
      return updated;
    });
    return changed ? next : node;
  }
  if (node && typeof node === "object") {
    const record = node as Record<string, unknown>;
    if (
      typeof record.id === "string" &&
      typeof record.viewCount === "number" &&
      record.id in results
    ) {
      const newCount = results[record.id] as number;
      if (record.viewCount === newCount) {
        return node;
      }
      return { ...record, viewCount: newCount };
    }
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
      const updated = updatePostsDeep(value, results);
      next[key] = updated;
      if (updated !== value) {
        changed = true;
      }
    }
    return changed ? next : node;
  }
  return node;
}

async function flushViews(): Promise<void> {
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
    });
    if (response.ok && queryClientRef) {
      const body = (await response.json()) as {
        results?: Record<string, number>;
      };
      if (body.results) {
        applyViewCounts(queryClientRef, body.results);
      }
    }
  } catch (error) {
    debugLog.views("Failed to batch increment views:", error);
  }
}

function scheduleFlush(): void {
  if (flushTimer) {
    return;
  }
  flushTimer = setTimeout(() => {
    void flushViews();
  }, FLUSH_DELAY_MS);
}

export function useIncrementViewMutation() {
  const queryClient = useQueryClient();

  // Keep a module-level handle to the active QueryClient so the debounced,
  // module-scoped flushViews can apply the returned counts to the cache. The
  // assignment happens in an effect to avoid mutating a module variable during
  // render (which the React Compiler flags as a side effect).
  useEffect(() => {
    queryClientRef = queryClient;
  }, [queryClient]);

  return useMutation({
    mutationFn: (postId: string) => {
      debugLog.views(`Queuing view increment for post: ${postId}`);
      pendingViews.add(postId);

      if (pendingViews.size >= MAX_BATCH) {
        void flushViews();
      } else {
        scheduleFlush();
      }

      return Promise.resolve({ postId, queued: true });
    },
    retry: false,
  });
}
