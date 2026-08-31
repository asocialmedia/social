import { clientLog } from "@asm/config/debug";
import type { BookmarkInfo } from "@asm/db";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryKey } from "@tanstack/react-query";
import { Bookmark, BookmarkCheck, BookmarkX } from "lucide-react";
import { useCallback } from "react";

import { adjustBookmarkCount } from "@/hooks/use-bookmark-count";
import { useRequireAuth } from "@/hooks/use-require-auth";
import { useToast } from "@/lib/gooey-toast";
import kyInstance from "@/lib/ky";
import { cn } from "@/lib/utils";

interface BookmarkButtonProps {
  className?: string;
  initialState: BookmarkInfo;
  kind?: "post" | "gust";
  postId: string;
}

const BookmarkCheckIcon = <BookmarkCheck />;
const BookmarkXIcon = <BookmarkX />;

export default function BookmarkButton({
  className,
  kind = "post",
  postId,
  initialState,
}: BookmarkButtonProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isLoggedIn, goToLogin } = useRequireAuth();
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
      // Roll back the optimistic count so it can't drift from the server.
      adjustBookmarkCount(queryClient, kind, data.isBookmarkedByUser ? 1 : -1);
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
      const previousState = queryClient.getQueryData<BookmarkInfo>(queryKey);
      queryClient.setQueryData<BookmarkInfo>(queryKey, () => ({
        isBookmarkedByUser: !previousState?.isBookmarkedByUser,
      }));
      // Optimistically bump the shared count so the sidebar badge and mobile
      // nav update instantly; reconcile against the server on success.
      adjustBookmarkCount(queryClient, kind, data.isBookmarkedByUser ? -1 : 1);

      return { previousState };
    },
    onSettled: () => {
      // Reconcile the optimistic count with the server's authoritative value.
      void queryClient.invalidateQueries({
        queryKey: ["bookmark-count"],
      });
    },
  });

  const handleBookmark = useCallback(() => {
    if (!isLoggedIn) {
      goToLogin();
      return;
    }
    mutate();
  }, [goToLogin, isLoggedIn, mutate]);

  return (
    <button
      aria-label={data.isBookmarkedByUser ? "Remove bookmark" : "Bookmark post"}
      className={cn(
        "group text-muted-foreground inline-flex h-7 w-7 items-center justify-center rounded-full border-0 p-0 transition-all duration-200 ease-out outline-none active:translate-y-px sm:h-7.5 sm:w-7.5",
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
          "size-4 transition-colors sm:size-4.5",
          data.isBookmarkedByUser && "fill-white text-white"
        )}
      />
    </button>
  );
}
