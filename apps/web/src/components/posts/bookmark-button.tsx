import { clientLog } from "@asm/config/debug";
import type { BookmarkInfo } from "@asm/db";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryKey } from "@tanstack/react-query";
import { Bookmark, BookmarkCheck, BookmarkX } from "lucide-react";
import { useCallback } from "react";

import { useToast } from "@/lib/gooey-toast";
import kyInstance from "@/lib/ky";
import { cn } from "@/lib/utils";

interface BookmarkButtonProps {
  className?: string;
  initialState: BookmarkInfo;
  postId: string;
}

const BookmarkCheckIcon = <BookmarkCheck />;
const BookmarkXIcon = <BookmarkX />;

export default function BookmarkButton({
  className,
  postId,
  initialState,
}: BookmarkButtonProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const queryKey: QueryKey = ["bookmark-info", postId];
  const { data } = useQuery({
    initialData: initialState,
    queryFn: () =>
      kyInstance.get(`/api/posts/${postId}/bookmark`).json<BookmarkInfo>(),
    queryKey,
    staleTime: Number.POSITIVE_INFINITY,
  });

  const { mutate } = useMutation({
    mutationFn: () =>
      data.isBookmarkedByUser
        ? kyInstance.delete(`/api/posts/${postId}/bookmark`)
        : kyInstance.post(`/api/posts/${postId}/bookmark`),
    onError(error, _variables, context) {
      queryClient.setQueryData(queryKey, context?.previousState);
      clientLog.error(error);
      toast({
        description: "That didn't go through, give it another try?",
        variant: "destructive",
      });
    },
    onMutate: async () => {
      toast({
        description: data.isBookmarkedByUser
          ? "Removed from your bookmarks"
          : "Post saved, find it anytime in your bookmarks",
        icon: data.isBookmarkedByUser ? BookmarkXIcon : BookmarkCheckIcon,
        title: data.isBookmarkedByUser ? "Bookmark Removed" : "Bookmarked",
      });

      await queryClient.cancelQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ["bookmark-count"] });
      const previousState = queryClient.getQueryData<BookmarkInfo>(queryKey);
      queryClient.setQueryData<BookmarkInfo>(queryKey, () => ({
        isBookmarkedByUser: !previousState?.isBookmarkedByUser,
      }));

      return { previousState };
    },
  });

  const handleBookmark = useCallback(() => mutate(), [mutate]);

  return (
    <button
      aria-label={data.isBookmarkedByUser ? "Remove bookmark" : "Bookmark post"}
      className={cn(
        "group text-muted-foreground inline-flex h-8 items-center justify-center rounded-full border-0 px-2 text-sm font-medium transition-all duration-200 ease-out outline-none active:translate-y-px",
        !data.isBookmarkedByUser && "pill-3d-hover",
        data.isBookmarkedByUser &&
          "bg-gradient-to-b from-[#fbbf24] to-[#d97706] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(150,90,0,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)]",
        className
      )}
      onClick={handleBookmark}
      type="button"
    >
      <Bookmark
        className={cn(
          "size-5 transition-colors",
          data.isBookmarkedByUser && "fill-white text-white"
        )}
      />
    </button>
  );
}
