"use client";

import type { PostData } from "@asm/db";
import { Separator } from "@asm/ui/shadui/separator";
import { useQueryClient } from "@tanstack/react-query";
import React, { useEffect, useMemo, useState } from "react";
import PostCard from "./feedview/post-card";

interface FeedViewProps {
  posts: PostData[];
}

export const FeedView: React.FC<FeedViewProps> = ({ posts: initialPosts }) => {
  const MemoizedPostCard = useMemo(() => React.memo(PostCard), []);
  const queryClient = useQueryClient();
  const [posts, setPosts] = useState<PostData[]>(initialPosts);

  useEffect(() => {
    const unsubscribe = queryClient.getQueryCache().subscribe(() => {
      setTimeout(() => {
        const feedQueries = queryClient.getQueriesData<{
          pages: { posts: PostData[] }[];
        }>({
          queryKey: ["post-feed", "for-you"],
        });

        if (feedQueries.length > 0) {
          const updatedPosts = feedQueries.flatMap(([, data]) =>
            (data?.pages?.flatMap((page) => page.posts) || []).filter(Boolean)
          );

          if (updatedPosts.length) {
            const uniquePosts = Array.from(
              new Map(updatedPosts.map((post) => [post.id, post])).values()
            );
            setPosts(uniquePosts);
          }
        }
      }, 0);
    });

    return () => {
      unsubscribe();
    };
  }, [queryClient]);

  useEffect(() => {
    const safeInitial = (initialPosts || []).filter(Boolean);
    const initialFirstId = safeInitial[0]?.id;
    const currentFirstId = posts[0]?.id;
    if (
      safeInitial.length > 0 &&
      (posts.length === 0 ||
        (initialFirstId && currentFirstId !== initialFirstId))
    ) {
      const uniquePosts = Array.from(
        new Map(safeInitial.map((post) => [post.id, post])).values()
      );
      setPosts(uniquePosts);
    }
  }, [initialPosts, posts]);

  const sortedPosts = useMemo(
    () =>
      [...posts]
        .filter(Boolean)
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        ),
    [posts]
  );

  return (
    <div className="flex flex-col">
      {sortedPosts.map((post, index) => (
        <React.Fragment key={post.id}>
          {index > 0 && <Separator className="bg-border/60" />}
          <MemoizedPostCard isJoined={true} post={post} />
        </React.Fragment>
      ))}
      {sortedPosts.length === 0 && (
        <div className="flex flex-col items-center justify-center py-6 sm:py-8">
          <p className="text-center text-muted-foreground text-sm sm:text-base">
            No Fleets to show here.
          </p>
        </div>
      )}
    </div>
  );
};
