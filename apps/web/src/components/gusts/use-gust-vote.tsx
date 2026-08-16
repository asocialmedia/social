"use client";

import { clientLog } from "@asm/config/debug";
import type { VoteInfo } from "@asm/db";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryKey } from "@tanstack/react-query";
import { ArrowBigDown, ArrowBigUp, Flame } from "lucide-react";
import { useCallback } from "react";

import { useRequireAuth } from "@/hooks/use-require-auth";
import { applyAuraToCaches } from "@/lib/cache-sync";
import { useToast } from "@/lib/gooey-toast";
import kyInstance from "@/lib/ky";

interface UseGustVoteOptions {
  authorName: string;
  initialState: VoteInfo;
  postId: string;
}

function calculateVoteChange(oldVote: number, newVote: number): number {
  if (oldVote === newVote) {
    return -oldVote;
  }
  if (oldVote === 0) {
    return newVote;
  }
  return newVote - oldVote;
}

// Shared vote logic for a gust. Both the rail action button and the card's
// double-tap amplify gesture drive the same ["vote-info", postId] cache so the
// aura count and active state stay in sync no matter which surface triggered it.
export function useGustVote({
  authorName,
  initialState,
  postId,
}: UseGustVoteOptions) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isLoggedIn, goToLogin } = useRequireAuth();
  const queryKey: QueryKey = ["vote-info", postId];
  const voteEndpoint = `/api/posts/${postId}/votes`;

  const { data } = useQuery({
    initialData: initialState,
    queryFn: () => kyInstance.get(voteEndpoint).json<VoteInfo>(),
    queryKey,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    // The feed payload already includes aura + the user's vote, and the
    // mutation reconciles server state on success, so refetching on every
    // mount/window-focus is pure waste (it caused 2x requests per post).
    staleTime: 5 * 60 * 1000,
  });

  const { mutate } = useMutation<
    { serverResponse: VoteInfo; voteAttempted: number },
    Error,
    { force?: boolean; previousVote: number; vote: number },
    { previousState: VoteInfo | undefined }
  >({
    mutationFn: async ({ force, previousVote, vote }) => {
      // The toggle decision uses the vote captured at call time (before the
      // optimistic onMutate write touches the cache), so a fresh amplify isn't
      // mistaken for a toggle-off. The double-tap gesture forces +1
      // (TikTok-style): even when already amplified we re-issue the upvote so
      // the aura stays credited and the optimistic cache stays consistent.
      const shouldClear = !force && vote === previousVote;
      const response = shouldClear
        ? await kyInstance.delete(voteEndpoint).json<VoteInfo>()
        : await kyInstance
            .post(voteEndpoint, { json: { value: vote } })
            .json<VoteInfo>();
      return { serverResponse: response, voteAttempted: vote };
    },
    onError(error, _variables, context) {
      queryClient.setQueryData(queryKey, context?.previousState);
      clientLog.error(error);
      toast({
        description: "That didn't go through, give it another try?",
        variant: "destructive",
      });
    },
    onMutate: async ({ vote, force }) => {
      await queryClient.cancelQueries({ queryKey });
      const previousState = queryClient.getQueryData<VoteInfo>(queryKey);
      queryClient.setQueryData<VoteInfo>(queryKey, (old) => {
        if (!old) {
          return old;
        }
        // Forced amplify is a no-op when already amplified (aura unchanged);
        // the visual heart burst carries the feedback instead. A non-forced
        // vote equal to the current one clears the vote (toggle off).
        const nextVote = force ? Math.max(old.userVote, vote) : vote;
        let newUserVote: number;
        if (!force && vote === old.userVote) {
          newUserVote = 0;
        } else if (force && vote === old.userVote) {
          newUserVote = old.userVote;
        } else {
          newUserVote = nextVote;
        }
        const voteChange =
          force && old.userVote === vote
            ? 0
            : calculateVoteChange(old.userVote, newUserVote);
        const newAura = old.aura + voteChange;
        // Mirror into every cached shape of this post (feed grids, profile
        // tiles, single-post cache) so aura stays consistent everywhere.
        applyAuraToCaches(queryClient, postId, newAura, newUserVote);
        return {
          aura: newAura,
          userVote: newUserVote,
        };
      });
      return { previousState };
    },
    // oxlint-disable-next-line react/no-unstable-nested-components
    onSuccess: (result, variables) => {
      const { serverResponse } = result;
      const { previousVote } = variables;
      queryClient.setQueryData<VoteInfo>(queryKey, {
        aura: serverResponse.aura,
        userVote: serverResponse.userVote,
      });
      applyAuraToCaches(
        queryClient,
        postId,
        serverResponse.aura,
        serverResponse.userVote
      );

      // Double-tap amplifies are silent (the floating flame burst on the video
      // is the feedback); only the rail button shows the toast, so rapid taps
      // don't spam "+1 Aura".
      if (variables.force) {
        return;
      }
      if (serverResponse.userVote === 1) {
        toast({
          description: `Amplified ${authorName}'s gust, nice boost!`,
          icon: <Flame />,
          title: "+1 Aura",
        });
      } else if (serverResponse.userVote === -1) {
        toast({
          description: `Muted ${authorName}'s gust, we'll show you fewer like this`,
          icon: <ArrowBigDown />,
          title: "Muted",
        });
      } else if (serverResponse.userVote === 0 && previousVote === 1) {
        toast({
          description: "You can always amplify it again later",
          icon: <Flame />,
          title: "Amplification Removed",
        });
      } else if (serverResponse.userVote === 0 && previousVote === -1) {
        toast({
          description: "It'll show up normally again",
          icon: <ArrowBigUp />,
          title: "Mute Removed",
        });
      }
    },
  });

  // Toggle used by the rail button (up/down).
  const toggleVote = useCallback(
    (vote: number) => {
      if (!isLoggedIn) {
        goToLogin();
        return;
      }
      mutate({ force: false, previousVote: data.userVote, vote });
    },
    [data.userVote, goToLogin, isLoggedIn, mutate]
  );

  // Idempotent upvote used by the double-tap gesture: it amplifies once and
  // never un-amplifies (mirroring TikTok's double-tap).
  const amplify = useCallback(() => {
    if (!isLoggedIn) {
      goToLogin();
      return;
    }
    mutate({ force: true, previousVote: data.userVote, vote: 1 });
  }, [data.userVote, goToLogin, isLoggedIn, mutate]);

  return {
    amplify,
    aura: data.aura,
    isAmplified: data.userVote === 1,
    toggleVote,
    userVote: data.userVote,
  };
}
