"use client";

import type { PostData } from "@asm/db";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import kyInstance from "@/lib/ky";

// eslint-disable-next-line import/no-cycle -- related posts reuse post-card which renders media-previews, which opens this viewer
import PostCard from "./post-card";

interface RelatedPostsProps {
  excludePostId: string;
}

// Related-post list for the media viewer sidebar. Uses the same PostCard
// component ranked semantically by topic tags and vector embeddings.
export default function RelatedPosts({ excludePostId }: RelatedPostsProps) {
  const { data, status } = useQuery({
    queryFn: async () => {
      const result = await kyInstance
        .get(`/api/posts/${excludePostId}/related`)
        .json<{ posts: PostData[] }>();
      return result;
    },
    queryKey: ["related-posts", excludePostId],
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    staleTime: 60 * 1000,
  });

  const posts = useMemo(
    () => (data?.posts || []).filter((post) => post.id !== excludePostId),
    [data?.posts, excludePostId]
  );

  if (status === "pending") {
    return (
      <div className="space-y-3 px-4 py-3">
        <div className="bg-border/40 h-32 animate-pulse rounded-lg" />
        <div className="bg-border/40 h-32 animate-pulse rounded-lg" />
        <div className="bg-border/40 h-32 animate-pulse rounded-lg" />
      </div>
    );
  }

  if (status === "error" || posts.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      {posts.map((post) => (
        <PostCard isJoined key={post.id} mobileLayout post={post} />
      ))}
    </div>
  );
}
