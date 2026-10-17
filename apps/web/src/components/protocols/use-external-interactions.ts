// oxlint-disable react/todo -- Async mutations release request guards in finally, including failed requests.
"use client";

import type { ExternalPost } from "@asm/protocols/contracts";
import { externalStateSchema } from "@asm/protocols/discovery";
import type { ExternalMutation } from "@asm/protocols/discovery";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { useRequireAuth } from "@/hooks/auth/use-require-auth";
import { useToast } from "@/lib/gooey-toast";
import { applyExternalStateToCaches } from "@/lib/protocols/external-cache";

export function useExternalInteractions(
  post: Pick<ExternalPost, "id" | "asm">
) {
  const auth = useRequireAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const queryKey = ["external-interaction", auth.user?.id ?? "guest", post.id];
  const { data: state } = useQuery({
    enabled: false,
    initialData: post.asm ?? {
      amplifications: 0,
      amplified: false,
      bookmarked: false,
      comments: 0,
    },
    queryFn: () =>
      post.asm ?? {
        amplifications: 0,
        amplified: false,
        bookmarked: false,
        comments: 0,
      },
    queryKey,
  });
  useEffect(() => {
    if (post.asm) {
      queryClient.setQueryData(
        ["external-interaction", auth.user?.id ?? "guest", post.id],
        post.asm
      );
    }
  }, [auth.user?.id, post.id, post.asm, queryClient]);
  const mutate = async (input: ExternalMutation) => {
    if (!auth.isLoggedIn) {
      auth.goToLogin();
      return false;
    }
    if (busy.current) {
      return false;
    }
    busy.current = true;
    setPending(true);
    try {
      const response = await fetch("/api/protocols/bluesky/interactions", {
        body: JSON.stringify(input),
        headers: { "content-type": "application/json" },
        method: "POST",
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) {
        let message = "Couldn't save. Please try again.";
        if (response.status === 429) {
          message = "Please wait a moment before trying again.";
        }
        if (response.status === 410) {
          message = "The source post is unavailable.";
        }
        throw new Error(message);
      }
      const next = externalStateSchema.parse(await response.json());
      applyExternalStateToCaches(
        queryClient,
        auth.user?.id ?? "guest",
        post.id,
        next
      );
      await queryClient.invalidateQueries({ queryKey: ["external-library"] });
      await queryClient.invalidateQueries({
        queryKey: ["external-discussion", post.id],
      });
      return true;
    } catch (error) {
      toast({
        title:
          error instanceof Error
            ? error.message
            : "Couldn't save. Please try again.",
        variant: "destructive",
      });
      return false;
    } finally {
      busy.current = false;
      setPending(false);
    }
  };
  return { mutate, pending, state };
}
