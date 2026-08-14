import { clientLog } from "@asm/config/debug";
import type { VoteInfo } from "@asm/db";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryKey } from "@tanstack/react-query";
import { ArrowBigDown, ArrowBigUp, Flame, RotateCcw } from "lucide-react";
import { useCallback } from "react";

import { useRequireAuth } from "@/hooks/use-require-auth";
import { useToast } from "@/lib/gooey-toast";
import kyInstance from "@/lib/ky";
import { cn, formatNumber } from "@/lib/utils";

interface AuraVoteButtonProps {
  authorName: string;
  // When set, the vote targets a comment eddy instead of a post. The rest of
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
  commentId,
  expandable = true,
  initialState,
  postId,
}: AuraVoteButtonProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isLoggedIn, goToLogin } = useRequireAuth();
  const isComment = commentId !== undefined;
  const noun = isComment ? "eddy" : "post";
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

      // Comment votes don't change the post's aura, so only mirror the
      // optimistic state into the single-post cache for actual post votes.
      if (!isComment) {
        queryClient.setQueryData(["post", postId], (oldPost: unknown) => {
          if (!oldPost || typeof oldPost !== "object") {
            return oldPost;
          }
          const currentPost = oldPost as {
            aura: number;
            vote: { userId: string; value: number }[];
          };
          const voteChange = calculateVoteChange(
            currentPost.vote[0]?.value || 0,
            newVote
          );
          return {
            ...currentPost,
            aura: currentPost.aura + voteChange,
            vote:
              newVote === 0 ? [] : [{ userId: "currentUser", value: newVote }],
          };
        });
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

      // Keep the single-post cache in sync with the confirmed server state
      // (comment votes don't touch the post's aura).
      if (!isComment) {
        queryClient.setQueryData(["post", postId], (oldPost: unknown) => {
          if (!oldPost || typeof oldPost !== "object") {
            return oldPost;
          }
          const currentPost = oldPost as {
            aura: number;
            vote: { userId: string; value: number }[];
          };
          return {
            ...currentPost,
            aura: serverResponse.aura,
            vote:
              serverResponse.userVote === 0
                ? []
                : [{ userId: "currentUser", value: serverResponse.userVote }],
          };
        });
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
    "group inline-flex h-8 items-center justify-center rounded-full border-0 px-2 font-medium text-sm text-muted-foreground outline-none transition-all duration-200 ease-out active:translate-y-px";

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
    <div className="flex items-center gap-1">
      <button
        aria-label="Amplify"
        className={cn(
          baseButtonClasses,
          data.userVote === 1 ? upGradientClasses : upHoverClasses
        )}
        onClick={handleVoteUp}
        type="button"
      >
        <ArrowBigUp
          className={cn(
            "size-5 transition-all duration-200",
            data.userVote === 1 ? "fill-white" : ""
          )}
        />
        {expandable ? (
          <span className="max-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 group-hover:ml-2 group-hover:max-w-20">
            Amplify
          </span>
        ) : null}
      </button>
      <button
        aria-label="Mute"
        className={cn(
          baseButtonClasses,
          data.userVote === -1 ? downGradientClasses : downHoverClasses
        )}
        onClick={handleVoteDown}
        type="button"
      >
        <ArrowBigDown
          className={cn(
            "size-5 transition-all duration-200",
            data.userVote === -1 ? "fill-white" : ""
          )}
        />
        {expandable ? (
          <span className="max-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 group-hover:ml-2 group-hover:max-w-20">
            Mute
          </span>
        ) : null}
      </button>
      <span
        className="text-muted-foreground flex h-8 items-center gap-1 rounded-full px-2 text-base font-semibold tabular-nums"
        title="Aura"
      >
        <Flame aria-hidden="true" className="h-6 w-6 text-orange-500" />
        {formatNumber(data.aura)}
      </span>
    </div>
  );
}
