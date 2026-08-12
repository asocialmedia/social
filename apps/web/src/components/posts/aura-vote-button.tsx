import type { VoteInfo } from "@asm/db";
import {
  type QueryKey,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { ArrowBigDown, ArrowBigUp, Flame, RotateCcw } from "lucide-react";
import { useCallback } from "react";
import { useToast } from "@/lib/gooey-toast";
import kyInstance from "@/lib/ky";
import { cn, formatNumber } from "@/lib/utils";

interface AuraVoteButtonProps {
  authorName: string;
  initialState: VoteInfo;
  postId: string;
}

export default function AuraVoteButton({
  postId,
  initialState,
  authorName,
}: AuraVoteButtonProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const queryKey: QueryKey = ["vote-info", postId];

  const { data } = useQuery({
    queryKey,
    queryFn: () =>
      kyInstance.get(`/api/posts/${postId}/votes`).json<VoteInfo>(),
    initialData: initialState,
    staleTime: 0,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });

  const { mutate } = useMutation({
    mutationFn: async (vote: number) => {
      const response =
        vote === data.userVote
          ? await kyInstance
              .delete(`/api/posts/${postId}/votes`)
              .json<VoteInfo>()
          : await kyInstance
              .post(`/api/posts/${postId}/votes`, { json: { value: vote } })
              .json<VoteInfo>();
      return { serverResponse: response, voteAttempted: vote };
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

      queryClient.setQueryData(["post", postId], (oldPost: unknown) => {
        if (!oldPost || typeof oldPost !== "object") {
          return oldPost;
        }
        const currentPost = oldPost as {
          aura: number;
          vote: Array<{ userId: string; value: number }>;
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
      return { previousState };
    },
    onSuccess: (result, _newVote) => {
      const { serverResponse } = result;
      queryClient.setQueryData<VoteInfo>(queryKey, {
        aura: serverResponse.aura,
        userVote: serverResponse.userVote,
      });

      // Keep the single-post cache in sync with the confirmed server state.
      queryClient.setQueryData(["post", postId], (oldPost: unknown) => {
        if (!oldPost || typeof oldPost !== "object") {
          return oldPost;
        }
        const currentPost = oldPost as {
          aura: number;
          vote: Array<{ userId: string; value: number }>;
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

      const previousVote = data.userVote;

      if (serverResponse.userVote === 1) {
        toast({
          title: "+1 Aura",
          description: `Amplified ${authorName}'s post, nice boost!`,
          icon: <Flame />,
        });
      } else if (serverResponse.userVote === -1) {
        toast({
          title: "Muted",
          description: `You muted ${authorName}'s post, we'll show you fewer posts like this`,
          icon: <ArrowBigDown />,
        });
      } else if (serverResponse.userVote === 0 && previousVote === 1) {
        toast({
          title: "Amplification Removed",
          description: "You can always amplify it again later",
          icon: <RotateCcw />,
        });
      } else if (serverResponse.userVote === 0 && previousVote === -1) {
        toast({
          title: "Mute Removed",
          description: "It'll show up in your feed normally again",
          icon: <RotateCcw />,
        });
      }
    },
    onError(error, _variables, context) {
      queryClient.setQueryData(queryKey, context?.previousState);
      console.error(error);
      toast({
        variant: "destructive",
        description: "That didn't go through, give it another try?",
      });
    },
  });

  const calculateVoteChange = (oldVote: number, newVote: number): number => {
    if (oldVote === newVote) {
      return -oldVote;
    }
    if (oldVote === 0) {
      return newVote;
    }
    return newVote - oldVote;
  };

  const handleVoteUp = useCallback(() => mutate(1), [mutate]);
  const handleVoteDown = useCallback(() => mutate(-1), [mutate]);

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
        <span className="max-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 group-hover:ml-2 group-hover:max-w-20">
          Amplify
        </span>
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
        <span className="max-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 group-hover:ml-2 group-hover:max-w-20">
          Mute
        </span>
      </button>
      <span
        className="flex h-8 items-center gap-1 rounded-full px-2 font-semibold text-muted-foreground text-sm tabular-nums"
        title="Aura"
      >
        <Flame aria-hidden="true" className="h-5 w-5 text-orange-500" />
        {formatNumber(data.aura)}
      </span>
    </div>
  );
}
