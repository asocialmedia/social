import type { BookmarkInfo } from "@asm/db";
import { useToast } from "@asm/ui/hooks/use-toast";
import {
  type QueryKey,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Bookmark } from "lucide-react";
import { useCallback } from "react";
import kyInstance from "@/lib/ky";
import { cn } from "@/lib/utils";

interface BookmarkButtonProps {
  className?: string;
  initialState: BookmarkInfo;
  postId: string;
}

export default function BookmarkButton({
  className,
  postId,
  initialState,
}: BookmarkButtonProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const queryKey: QueryKey = ["bookmark-info", postId];
  const { data } = useQuery({
    queryKey,
    queryFn: () =>
      kyInstance.get(`/api/posts/${postId}/bookmark`).json<BookmarkInfo>(),
    initialData: initialState,
    staleTime: Number.POSITIVE_INFINITY,
  });

  const { mutate } = useMutation({
    mutationFn: () =>
      data.isBookmarkedByUser
        ? kyInstance.delete(`/api/posts/${postId}/bookmark`)
        : kyInstance.post(`/api/posts/${postId}/bookmark`),
    onMutate: async () => {
      toast({
        description: `Post ${data.isBookmarkedByUser ? "un" : ""}bookmarked`,
      });

      await queryClient.cancelQueries({ queryKey });
      const previousState = queryClient.getQueryData<BookmarkInfo>(queryKey);
      queryClient.setQueryData<BookmarkInfo>(queryKey, () => ({
        isBookmarkedByUser: !previousState?.isBookmarkedByUser,
      }));

      return { previousState };
    },
    onError(error, _variables, context) {
      queryClient.setQueryData(queryKey, context?.previousState);
      console.error(error);
      toast({
        variant: "destructive",
        description: "Something went wrong. Please try again.",
      });
    },
  });

  const handleBookmark = useCallback(() => mutate(), [mutate]);

  return (
    <button
      aria-label={data.isBookmarkedByUser ? "Remove bookmark" : "Bookmark post"}
      className={cn(
        "group inline-flex h-8 items-center justify-center rounded-full border-0 px-2 font-medium text-muted-foreground text-sm outline-none transition-all duration-200 ease-out active:translate-y-px",
        !data.isBookmarkedByUser &&
          "hover:bg-gradient-to-b hover:from-[#8f96a3] hover:to-[#5c6370] hover:text-white hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(45,50,60,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)]",
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
