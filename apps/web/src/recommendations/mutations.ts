"use client";

import { clientLog } from "@asm/config/debug";
import { useMutation } from "@tanstack/react-query";

import { hideRecommendationPost, unhideRecommendationPost } from "./actions";

// Durable "Not interested" / undo. The ranked surfaces hide the post locally
// the moment either fires (the recommendation window events), so these
// mutations only own the server write - no cache invalidation, which would
// otherwise refetch the feed and shuffle everything the viewer is reading.
export function useHideRecommendationPostMutation() {
  return useMutation({
    mutationFn: (postId: string) => hideRecommendationPost(postId),
    onError(error) {
      clientLog.error("Failed to hide recommendation post:", error);
    },
  });
}

export function useUnhideRecommendationPostMutation() {
  return useMutation({
    mutationFn: (postId: string) => unhideRecommendationPost(postId),
    onError(error) {
      clientLog.error("Failed to unhide recommendation post:", error);
    },
  });
}
