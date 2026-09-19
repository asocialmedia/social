import { clientLog } from "@asm/config/debug";
import type { PostsPage } from "@asm/db";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { InfiniteData } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";

import { useToast } from "@/lib/gooey-toast";
import {
  applyPostAuraDeltaToCaches,
  applyResponseCountDeltaToCaches,
  removePostFromFeedCache,
} from "@/lib/posts/cache-sync";
import { getShortPostId } from "@/lib/seo/seo";

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

      if (deletedPost.parentPostId) {
        applyResponseCountDeltaToCaches(
          queryClient,
          deletedPost.parentPostId,
          -1
        );
        applyPostAuraDeltaToCaches(queryClient, deletedPost.parentPostId, -1);
        queryClient.invalidateQueries({
          queryKey: ["vote-info", deletedPost.parentPostId],
        });
        queryClient.invalidateQueries({
          queryKey: ["post", deletedPost.parentPostId],
        });
      }

      // A native community post also lives in that community's feed(s) - the
      // community page, and the community-first related feed on its detail
      // page. Drop it from those caches and refetch, otherwise the deleted post
      // lingered there until a full reload (only the create path invalidated
      // community-feed before this).
      if (deletedPost.community?.slug) {
        removePostFromFeedCache(
          queryClient,
          ["community-feed"],
          deletedPost.id
        );
        queryClient.invalidateQueries({ queryKey: ["community-feed"] });
      }

      // Deleting a community post moves the community's post count, so the
      // discovery grid's card stats need a refetch too. The community page's
      // server-rendered stats (the About card's community aura) come from the
      // RSC payload, so refresh the current route to pick up the invalidated
      // server cache as well.
      if (deletedPost.communityId) {
        queryClient.invalidateQueries({ queryKey: ["communities"] });
        router.refresh();
      }

      toast({
        description: "Post deleted",
      });

      const shortId = getShortPostId(deletedPost.id);
      // Matches both the global /posts/<id> path and a community post's nested
      // /a/<slug>/posts/<id> path, on the detail page or any of its subpaths.
      const isPostPage =
        pathname?.includes(`/posts/${shortId}`) ||
        pathname?.includes(`/posts/${deletedPost.id}`);

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
