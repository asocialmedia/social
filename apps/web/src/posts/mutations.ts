import { clientLog } from "@asm/config/debug";
import type { PostsPage } from "@asm/db";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { InfiniteData } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";

import { useToast } from "@/lib/gooey-toast";
import { getShortPostId } from "@/lib/seo";

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

      const shortId = getShortPostId(deletedPost.id);
      const isPostPage =
        pathname === `/posts/${shortId}` ||
        pathname?.startsWith(`/posts/${shortId}/`) ||
        pathname === `/posts/${deletedPost.id}` ||
        pathname?.startsWith(`/posts/${deletedPost.id}/`);

      if (isPostPage) {
        if (deletedPost.user?.username) {
          router.push(`/users/${deletedPost.user.username}`);
        } else {
          router.push("/");
        }
      }
    },
  });

  return mutation;
}

export function useModeratePostMutation() {
  const { toast } = useToast();

  const queryClient = useQueryClient();
  const router = useRouter();

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
      // Moderation is rare, so invalidating broadly is cheap and guarantees
      // every surface (feed, gust reels, profile, viewer) shows the latest flag
      // state. All invalidations run in parallel; the unread notification count
      // reflects the moderation bell entry right away. router.refresh() repulls
      // the server-rendered post detail + media pages (they receive PostData as
      // props rather than a client query).
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["post-feed"] }),
        queryClient.invalidateQueries({ queryKey: ["gusts-feed"] }),
        queryClient.invalidateQueries({ queryKey: ["related-posts"] }),
        queryClient.invalidateQueries({ queryKey: ["post-history"] }),
        queryClient.invalidateQueries({
          queryKey: ["unread-notification-count"],
        }),
      ]);
      router.refresh();

      toast({ description: "Post updated" });
    },
  });

  return mutation;
}
