"use client";

import type { ExternalPost } from "@asm/protocols/contracts";
import { externalFeedbackKey } from "@asm/protocols/discovery";
import type { ExternalFeedback } from "@asm/protocols/discovery";
import { useRef } from "react";

import { useSession } from "@/app/(main)/session-provider";
import { trackNetworkAction } from "@/components/recommendations/recommendation-tracker";
import { useToast } from "@/lib/gooey-toast";
import { useFeedSourceStore } from "@/store/feed-source-store";

export function useExternalFeedback(post: ExternalPost) {
  const { user } = useSession();
  const { toast } = useToast();
  const pending = useRef(false);
  return async (scope: ExternalFeedback["scope"]) => {
    if (pending.current) {
      return;
    }
    pending.current = true;
    const viewer = user?.id ?? "guest";
    const feedback = { authorId: post.author.id, postId: post.id, scope };
    const key = externalFeedbackKey(feedback);
    const update = async (remove: boolean) => {
      if (user) {
        const response = await fetch("/api/protocols/bluesky/feedback", {
          body: JSON.stringify(feedback),
          headers: { "content-type": "application/json" },
          method: remove ? "DELETE" : "POST",
        });
        if (!response.ok) {
          throw new Error("Couldn't save preference. Please try again.");
        }
      }
      trackNetworkAction(
        post.id,
        remove ? "REMOVE_NOT_INTERESTED" : "NOT_INTERESTED"
      );
      useFeedSourceStore.getState().exclude(viewer, key, !remove);
    };
    try {
      await update(false);
      toast({
        button: {
          onClick: async () => {
            try {
              await update(true);
            } catch {
              toast({
                title: "Couldn't undo. Please try again.",
                variant: "destructive",
              });
            }
          },
          title: "Undo",
        },
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
