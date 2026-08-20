import { clientLog } from "@asm/config/debug";
import type { PostsPage } from "@asm/db";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { InfiniteData } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";

import { useToast } from "@/lib/gooey-toast";

import { deletePost, updatePostModeration } from "./actions";
import type { PostModerationChanges } from "./actions";

export function useDeletePostMutation() {
  const { toast } = useToast();

  const queryClient = useQueryClient();

  const router = useRouter();
  const pathname = usePathname();

  const mutation = useMutation({
    mutationFn: deletePost,
    onError(error) {
      clientLog.error(error);
      toast({
        description: "Couldn't delete that post, try again?",
        variant: "destructive",
      });
    },
    onSuccess: async (deletedPost) => {
      const queryFilter = { queryKey: ["post-feed"] };

      await queryClient.cancelQueries(queryFilter);

      queryClient.setQueriesData<InfiniteData<PostsPage, string | null>>(
        queryFilter,
        (oldData) => {
          if (!oldData) {
            return;
          }

          return {
            pageParams: oldData.pageParams,
            pages: oldData.pages.map((page) => ({
              nextCursor: page.nextCursor,
              posts: page.posts.filter((p) => p.id !== deletedPost.id),
            })),
          };
        }
      );

      toast({
        description: "Post deleted",
      });

      if (pathname === `/posts/${deletedPost.id}`) {
        router.push(`/users/${deletedPost.user.username}`);
      }
    },
  });

  return mutation;
}

export function useModeratePostMutation() {
  const { toast } = useToast();

  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (input: { changes: PostModerationChanges; postId: string }) =>
      updatePostModeration(input.postId, input.changes),
    onError(error) {
      clientLog.error(error);
      toast({
        description: "Couldn't update moderation, try again?",
        variant: "destructive",
      });
    },
    onSuccess: async () => {
      // Moderation is a rare action, so a full refetch is cheap and guarantees
      // every surface (feed, gust reels, profile, detail, viewer) shows the
      // latest flag state.
      await queryClient.invalidateQueries({ queryKey: ["post-feed"] });
      await queryClient.invalidateQueries({ queryKey: ["gusts-feed"] });

      toast({ description: "Post updated" });
    },
  });

  return mutation;
}
