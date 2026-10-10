import { useSyncExternalStore } from "react";

import { viewBatcher } from "../lib/view-batcher";

export function usePostViews(postId: string, fallback: number): number {
  return useSyncExternalStore(
    viewBatcher.subscribe,
    () => viewBatcher.count(postId, fallback),
    () => fallback
  );
}
