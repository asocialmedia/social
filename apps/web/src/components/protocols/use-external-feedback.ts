// oxlint-disable react/todo -- Async preference saves restore the prior exclusion on failure.
"use client";

import type { ExternalPost } from "@asm/protocols/contracts";
import { externalFeedbackKey } from "@asm/protocols/discovery";
import type { ExternalFeedback } from "@asm/protocols/discovery";
import { useRef } from "react";

import { useSession } from "@/app/(main)/session-provider";
import { trackNetworkAction } from "@/components/recommendations/recommendation-tracker";
import { useToast } from "@/lib/gooey-toast";
import { useFeedSourceStore } from "@/store/feed-source-store";

export function useExternalFeedback(post: ExternalPost | undefined) {
  const { user } = useSession();
  const { toast } = useToast();
  const pending = useRef(false);
  return async (scope: ExternalFeedback["scope"]) => {
    if (!post || pending.current) {
      return;
    }
    pending.current = true;
    const viewer = user?.id ?? "guest";
    const feedback = { authorId: post.author.id, postId: post.id, scope };
    const key = externalFeedbackKey(feedback);
    const update = async () => {
      const store = useFeedSourceStore.getState();
      const wasHidden = store.excluded[viewer]?.has(key) ?? false;
      store.exclude(viewer, key, true);
      try {
        if (user) {
          const response = await fetch("/api/protocols/bluesky/feedback", {
            body: JSON.stringify(feedback),
            headers: { "content-type": "application/json" },
            method: "POST",
            signal: AbortSignal.timeout(20_000),
          });
          if (!response.ok) {
            throw new Error("Couldn't save preference. Please try again.");
          }
        }
      } catch (error) {
        useFeedSourceStore.getState().exclude(viewer, key, wasHidden);
        throw error;
      }
      trackNetworkAction(post.id, "NOT_INTERESTED");
    };
    try {
      await update();
      toast({
        description: user
          ? "Saved to your asocialmedia feed preferences."
          : "Saved for this session.",
        title:
          scope === "author"
            ? "Author muted in asocialmedia"
            : "Not interested",
      });
    } catch {
      toast({
        title: "Couldn't save preference. Please try again.",
        variant: "destructive",
      });
    }
    pending.current = false;
  };
}
