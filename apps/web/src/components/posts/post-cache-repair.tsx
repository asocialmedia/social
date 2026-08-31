"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import {
  forceInvalidatePostFeeds,
  repairStalePostCaches,
} from "@/lib/cache-sync";

// Mount once in the authenticated shell: heals any `post.bookmarks` that was
// serialized without its viewer-scoped join (stale `use cache` SSR prop,
// persisted React Query page, or optimistic draft). Sync-patches to `[]` so
// `post.bookmarks.some` never throws, then triggers a background revalidation
// that respects Next.js 15 `cacheComponents` / `fetchCache` semantics:
// `router.refresh()` revalidates `use cache` / `cacheLife` server segments,
// `invalidateStalePostCaches` refetches the client `post-feed` queries.
export function PostCacheRepair() {
  const queryClient = useQueryClient();
  const router = useRouter();

  useEffect(() => {
    const didRepair = repairStalePostCaches(queryClient);
    if (didRepair) {
      forceInvalidatePostFeeds(queryClient);
      router.refresh();
    }
  }, [queryClient, router]);

  return null;
}
