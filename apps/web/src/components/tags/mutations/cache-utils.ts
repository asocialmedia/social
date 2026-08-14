import type { PostData } from "@asm/db";
import type { QueryClient } from "@tanstack/react-query";

export function updatePostInCaches(
  queryClient: QueryClient,
  postId: string,
  updater: (post: PostData) => PostData
) {
  queryClient.setQueryData(["post", postId], updater);

  for (const key of ["post-feed", "posts:for-you", "posts:following"]) {
    queryClient.setQueryData(
      [key],
      (oldData: { pages: { posts: PostData[] }[] } | undefined) => {
        if (!oldData) {
          return oldData;
        }
        return {
          ...oldData,
          pages: oldData.pages.map((page) => ({
            ...page,
            posts: page.posts.map((post) =>
              post.id === postId ? updater(post) : post
            ),
          })),
        };
      }
    );
  }
}
