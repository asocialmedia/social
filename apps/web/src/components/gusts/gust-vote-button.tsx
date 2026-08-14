"use client";

import { clientLog } from "@asm/config/debug";
import type { VoteInfo } from "@asm/db";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryKey } from "@tanstack/react-query";
import { ArrowBigDown, ArrowBigUp, Flame } from "lucide-react";
import { useCallback } from "react";

import { useRequireAuth } from "@/hooks/use-require-auth";
import { useToast } from "@/lib/gooey-toast";
import kyInstance from "@/lib/ky";
import { cn, formatNumber } from "@/lib/utils";

interface GustVoteButtonProps {
  authorName: string;
  direction: "up" | "down";
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

// Vertical vote action for the reels action rail. "up" amplifies and carries
// the bold orange aura count, "down" mutes the author. Both share the
// ["vote-info", postId] cache with AuraVoteButton so they stay in sync.
export default function GustVoteButton({
  authorName,
  direction,
  initialState,
  postId,
}: GustVoteButtonProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isLoggedIn, goToLogin } = useRequireAuth();
  const isUp = direction === "up";
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
    number,
    { previousState: VoteInfo | undefined }
  >({
    mutationFn: async (vote: number) => {
      const response =
        vote === data.userVote
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
    onMutate: async (newVote) => {
      await queryClient.cancelQueries({ queryKey });
      const previousState = queryClient.getQueryData<VoteInfo>(queryKey);
      queryClient.setQueryData<VoteInfo>(queryKey, (old) => {
        if (!old) {
          return old;
        }
        const voteChange = calculateVoteChange(old.userVote, newVote);
        return {
          aura: old.aura + voteChange,
          userVote: newVote === old.userVote ? 0 : newVote,
        };
      });
      return { previousState };
    },
    // oxlint-disable-next-line react/no-unstable-nested-components
    onSuccess: (result) => {
      const { serverResponse } = result;
      queryClient.setQueryData<VoteInfo>(queryKey, {
        aura: serverResponse.aura,
        userVote: serverResponse.userVote,
      });

      const previousVote = data.userVote;
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

  const isActive = data.userVote === (isUp ? 1 : -1);

  const handleVote = useCallback(() => {
    if (!isLoggedIn) {
      goToLogin();
      return;
    }
    let targetVote: number;
    if (isActive) {
      targetVote = 0;
    } else if (isUp) {
      targetVote = 1;
    } else {
      targetVote = -1;
    }
    mutate(targetVote);
  }, [goToLogin, isActive, isLoggedIn, mutate, isUp]);

  let ariaLabel: string;
  if (isActive && isUp) {
    ariaLabel = "Remove amplification";
  } else if (isActive && !isUp) {
    ariaLabel = "Remove mute";
  } else if (isUp) {
    ariaLabel = "Amplify gust";
  } else {
    ariaLabel = "Mute author's gust";
  }

  return (
    <div className="flex flex-col items-center gap-1">
      <button
        aria-label={ariaLabel}
        className={cn(
          "rail-3d-btn flex h-11 w-11 items-center justify-center rounded-full transition-transform hover:scale-105 active:scale-95",
          isActive && (isUp ? "rail-3d-btn-orange" : "rail-3d-btn-purple")
        )}
        onClick={handleVote}
        type="button"
      >
        {isUp ? (
          <ArrowBigUp
            className={cn("size-5 transition-colors", isActive && "fill-white")}
          />
        ) : (
          <ArrowBigDown
            className={cn("size-5 transition-colors", isActive && "fill-white")}
          />
        )}
      </button>

      {isUp ? (
        <span className="text-primary flex items-center gap-1 text-lg font-black tabular-nums drop-shadow-md">
          <Flame className="text-primary fill-primary size-5" />
          {formatNumber(data.aura)}
        </span>
      ) : null}
    </div>
  );
}
