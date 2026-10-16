"use client";

import type { PostPreviewSource } from "@asm/ui/lib/post-preview-layout";
import { useQueryClient } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useCallback, useSyncExternalStore } from "react";

import { cachedPostPreview } from "@/lib/posts/cached-post-preview";

import { PostCardSkeleton } from "./post-card-skeleton";

export function CachedPostCardSkeleton({
  post,
}: {
  post?: PostPreviewSource | null;
}) {
  const params = useParams<{ postId?: string }>();
  const queryClient = useQueryClient();
  const id = params?.postId;
  const cache = queryClient.getQueryCache();
  const subscribe = useCallback(
    (notify: () => void) => cache.subscribe(notify),
    [cache]
  );
  const getPreview = useCallback(() => {
    if (id) {
      for (const query of cache.findAll()) {
        const found = cachedPostPreview(query.state.data, id);
        if (found) {
          return found;
        }
      }
    }
  }, [cache, id]);
  const cached = useSyncExternalStore<PostPreviewSource | undefined>(
    subscribe,
    getPreview,
    () => post ?? undefined
  );
  const preview = post ?? cached;
  return <PostCardSkeleton detail post={preview} />;
}
