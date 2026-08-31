import { clientLog } from "@asm/config/debug";
import type { VoteInfo } from "@asm/db";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryKey } from "@tanstack/react-query";
import { ArrowBigDown, ArrowBigUp, Flame, RotateCcw } from "lucide-react";
import { useCallback } from "react";

import { useRequireAuth } from "@/hooks/use-require-auth";
import { getAuraFlameClass } from "@/lib/aura";
import { applyAuraToCaches, applyCommentAuraToCaches } from "@/lib/cache-sync";
import { useToast } from "@/lib/gooey-toast";
import kyInstance from "@/lib/ky";
import { cn, formatNumber } from "@/lib/utils";

interface AuraVoteButtonProps {
  authorName: string;
  className?: string;
  // When set, the vote targets a comment eddie instead of a post. The rest of
  // the component (optimistic aura, endpoints, toasts) adapts automatically so
  // posts and eddies share one implementation.
  commentId?: string;
  expandable?: boolean;
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

export default function AuraVoteButton({
  authorName,
  className,
  commentId,
  expandable = true,
  initialState,
  postId,
}: AuraVoteButtonProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isLoggedIn, goToLogin } = useRequireAuth();
  const isComment = commentId !== undefined;
  const noun = isComment ? "eddie" : "post";
  const queryKey: QueryKey = isComment
    ? ["comment-vote", commentId]
    : ["vote-info", postId];
  const voteEndpoint = isComment
    ? `/api/comments/${commentId}/vote`
    : `/api/posts/${postId}/votes`;

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
      const voteChange = calculateVoteChange(
        previousState?.userVote ?? 0,
        newVote
      );
      const optimisticAura = (previousState?.aura ?? 0) + voteChange;
      const optimisticUserVote =
        newVote === previousState?.userVote ? 0 : newVote;
      queryClient.setQueryData<VoteInfo>(queryKey, {
        aura: optimisticAura,
        userVote: optimisticUserVote,
      });

      // Comment votes only touch the comment's aura; post votes update the
      // post's cached vote state too.
      if (commentId) {
        applyCommentAuraToCaches(queryClient, commentId, optimisticAura);
      } else {
        applyAuraToCaches(
          queryClient,
          postId,
          optimisticAura,
          optimisticUserVote
        );
      }
      return { previousState };
    },
    // oxlint-disable-next-line react/no-unstable-nested-components
    onSuccess: (result, _newVote) => {
      const { serverResponse } = result;
      queryClient.setQueryData<VoteInfo>(queryKey, {
        aura: serverResponse.aura,
        userVote: serverResponse.userVote,
      });

      // Keep every cached shape in sync with the confirmed server state.
      if (commentId) {
        applyCommentAuraToCaches(queryClient, commentId, serverResponse.aura);
      } else {
        applyAuraToCaches(
          queryClient,
          postId,
          serverResponse.aura,
          serverResponse.userVote
        );
      }

      const previousVote = data.userVote;

      if (serverResponse.userVote === 1) {
        toast({
          description: `Amplified ${authorName}'s ${noun}, nice boost!`,
          icon: <Flame />,
          title: "+1 Aura",
        });
      } else if (serverResponse.userVote === -1) {
        toast({
          description: `You muted ${authorName}'s ${noun}, we'll show you fewer like this`,
          icon: <ArrowBigDown />,
          title: "Muted",
        });
      } else if (serverResponse.userVote === 0 && previousVote === 1) {
        toast({
          description: "You can always amplify it again later",
          icon: <RotateCcw />,
          title: "Amplification Removed",
        });
      } else if (serverResponse.userVote === 0 && previousVote === -1) {
        toast({
          description: "It'll show up normally again",
          icon: <RotateCcw />,
          title: "Mute Removed",
        });
      }
    },
  });

  const handleVoteUp = useCallback(() => {
    if (!isLoggedIn) {
      goToLogin();
      return;
    }
    mutate(1);
  }, [goToLogin, isLoggedIn, mutate]);
  const handleVoteDown = useCallback(() => {
    if (!isLoggedIn) {
      goToLogin();
      return;
    }
    mutate(-1);
  }, [goToLogin, isLoggedIn, mutate]);

  const baseButtonClasses =
    "group inline-flex h-7 sm:h-7.5 items-center justify-center rounded-full border-0 px-1.5 sm:px-2 font-medium text-xs sm:text-[13px] text-muted-foreground outline-none transition-all duration-200 ease-out active:translate-y-px";

  const upGradientClasses = cn(
    "vote-btn-up",
    "hover:from-[#ffa629] hover:to-[#f56a14]"
  );

  const downGradientClasses = cn(
    "vote-btn-down",
    "hover:from-[#8d6dff] hover:to-[#6b4ae8]"
  );

  const upHoverClasses =
    "hover:bg-gradient-to-b hover:from-[#ff9500] hover:to-[#e65500] hover:text-white hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.4),inset_0_1.5px_2px_rgba(255,255,255,0.6),0_0_0_1px_rgba(170,60,0,0.45),0_1px_1px_rgba(0,0,0,0.08),0_2px_4px_rgba(0,0,0,0.1)] dark:hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(170,60,0,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)]";

  const downHoverClasses =
    "hover:bg-gradient-to-b hover:from-[#7c5cff] hover:to-[#5a3ae0] hover:text-white hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.4),inset_0_1.5px_2px_rgba(255,255,255,0.6),0_0_0_1px_rgba(70,40,170,0.45),0_1px_1px_rgba(0,0,0,0.08),0_2px_4px_rgba(0,0,0,0.1)] dark:hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(70,40,170,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)]";

  return (
    <div
      className={cn("contents sm:flex sm:items-center sm:gap-1.5", className)}
    >
      <div className="flex items-center gap-0.5 sm:gap-1">
        <button
          aria-label="Amplify"
          className={cn(
            baseButtonClasses,
            data.userVote === 1
              ? cn(upGradientClasses, "text-white")
              : upHoverClasses
          )}
          onClick={handleVoteUp}
          type="button"
        >
          <ArrowBigUp
            className={cn(
              "size-4 transition-all duration-200 sm:size-4.5",
              data.userVote === 1 ? "fill-white" : ""
            )}
          />
          {expandable ? (
            <span className="max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-200 group-hover:ml-1.5 group-hover:max-w-20 group-hover:opacity-100">
              Amplify
            </span>
          ) : null}
        </button>
        <button
          aria-label="Mute"
          className={cn(
            baseButtonClasses,
            data.userVote === -1
              ? cn(downGradientClasses, "text-white")
              : downHoverClasses
          )}
          onClick={handleVoteDown}
          type="button"
        >
          <ArrowBigDown
            className={cn(
              "size-4 transition-all duration-200 sm:size-4.5",
              data.userVote === -1 ? "fill-white" : ""
            )}
          />
          {expandable ? (
            <span className="max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-200 group-hover:ml-1.5 group-hover:max-w-20 group-hover:opacity-100">
              Mute
            </span>
          ) : null}
        </button>
      </div>
      <span
        className="text-muted-foreground flex h-7 items-center gap-1 rounded-full px-1.5 text-xs font-semibold tabular-nums sm:h-7.5 sm:px-2 sm:text-[13px]"
        title="Aura"
      >
        <Flame
          aria-hidden="true"
          className={cn("h-4 w-4 sm:h-5 sm:w-5", getAuraFlameClass(data.aura))}
        />
        {formatNumber(data.aura)}
      </span>
    </div>
  );
}
