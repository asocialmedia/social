// oxlint-disable react/todo -- Async mutations release request guards in finally, including failed requests.
"use client";

import type { ExternalPost } from "@asm/protocols/contracts";
import { externalStateSchema } from "@asm/protocols/discovery";
import type { ExternalMutation } from "@asm/protocols/discovery";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { trackNetworkAction } from "@/components/recommendations/recommendation-tracker";
import { useRequireAuth } from "@/hooks/auth/use-require-auth";
import { useToast } from "@/lib/gooey-toast";
import { externalActionToast } from "@/lib/protocols/action-toast";
import {
  applyExternalStateToCaches,
  cachedExternalPost,
  isExternalViewerQuery,
  optimisticExternalState,
  patchExternalState,
} from "@/lib/protocols/external-cache";

export function useExternalInteractions(
  post: Pick<ExternalPost, "id" | "asm">
) {
  const auth = useRequireAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const pendingKey = [
    "external-interaction-pending",
    auth.user?.id ?? "guest",
    post.id,
  ];
  const { data: pending } = useQuery({
    enabled: false,
    initialData: false,
    queryFn: () => false,
    queryKey: pendingKey,
  });
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
    if (
      post.asm &&
      !queryClient.getQueryData([
        "external-interaction-pending",
        auth.user?.id ?? "guest",
        post.id,
      ])
    ) {
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
    if (queryClient.getQueryData(pendingKey)) {
      return false;
    }
    queryClient.setQueryData(pendingKey, true);
    const viewer = auth.user?.id ?? "guest";
    let previous: typeof state | undefined;
    let committed = false;
    try {
      await queryClient.cancelQueries({
        predicate: ({ queryKey: key, state: queryState }) =>
          isExternalViewerQuery(key, viewer) &&
          queryState.fetchMeta?.fetchMore === undefined &&
          Boolean(cachedExternalPost(queryState.data, post.id)),
      });
      previous = queryClient.getQueryData<typeof state>(queryKey) ?? state;
      applyExternalStateToCaches(
        queryClient,
        viewer,
        post.id,
        optimisticExternalState(previous, input)
      );
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
      const body: unknown = await response.json();
      const next = externalStateSchema.parse(body);
      const upstreamFailed = Boolean(
        body &&
        typeof body === "object" &&
        "upstream" in body &&
        body.upstream === "failed"
      );
      if (upstreamFailed) {
        toast({
          button: {
            onClick: async () => {
              await mutate(input);
            },
            title: "Retry",
          },
          description:
            "Retry, or reconnect Bluesky in settings if your connection needs updated permissions.",
          title: "Saved in asocialmedia; Bluesky sync failed",
        });
      }
      if (input.action === "bookmark" && next.bookmarked) {
        trackNetworkAction(post.id, "BOOKMARK");
      }
      if (input.action === "amplify" && next.amplified) {
        trackNetworkAction(post.id, "VOTE");
      }
      applyExternalStateToCaches(
        queryClient,
        auth.user?.id ?? "guest",
        post.id,
        next
      );
      committed = true;
      if (!upstreamFailed) {
        toast(externalActionToast(input));
      }
      if (input.action === "bookmark") {
        await queryClient.invalidateQueries({
          queryKey: ["post-feed", "bookmarks"],
        });
        await queryClient.invalidateQueries({
          queryKey: ["bookmark-count"],
        });
      }
      await queryClient.invalidateQueries({ queryKey: ["external-library"] });
      await queryClient.invalidateQueries({
        queryKey: ["external-discussion", post.id],
      });
      return true;
    } catch (error) {
      if (previous && !committed) {
        applyExternalStateToCaches(queryClient, viewer, post.id, previous);
      }
      toast({
        title:
          error instanceof Error
            ? error.message
            : "Couldn't save. Please try again.",
        variant: "destructive",
      });
      return false;
    } finally {
      queryClient.setQueryData(pendingKey, false);
      void (async () => {
        try {
          const pagination = queryClient
            .getQueryCache()
            .findAll({
              predicate: ({ queryKey: key, state: queryState }) =>
                isExternalViewerQuery(key, viewer) &&
                queryState.fetchStatus === "fetching" &&
                queryState.fetchMeta?.fetchMore !== undefined &&
                Boolean(cachedExternalPost(queryState.data, post.id)),
            })
            .map(async (query) => {
              await query.promise;
              const latestState =
                queryClient.getQueryData<typeof state>(queryKey);
              if (latestState) {
                queryClient.setQueryData(query.queryKey, (data: unknown) =>
                  patchExternalState(data, post.id, latestState)
                );
              }
            });
          await Promise.all([
            queryClient.invalidateQueries(
              {
                predicate: ({ queryKey: key, state: queryState }) =>
                  isExternalViewerQuery(key, viewer) &&
                  Boolean(cachedExternalPost(queryState.data, post.id)),
                refetchType: "active",
              },
              { cancelRefetch: false }
            ),
            ...pagination,
          ]);
        } catch {
          // Cache refresh failure must not change the completed action result.
        }
      })();
    }
  };
  return { mutate, pending, state };
}
