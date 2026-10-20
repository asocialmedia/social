"use client";

import type { ExternalPost } from "@asm/protocols/contracts";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import kyInstance from "@/lib/ky";
import { externalPostView } from "@/lib/posts/presentation";
import type { PresentedPost as PostData } from "@/lib/posts/presentation";

// eslint-disable-next-line import/no-cycle -- related posts reuse post-card which renders media-previews, which opens this viewer
import PostCard from "./post-card";

interface RelatedPostsProps {
  authorActor?: string;
  excludePostId: string;
  external?: boolean;
}

// Related-post list for the media viewer sidebar. Uses the same PostCard
// component ranked semantically by topic tags and vector embeddings.
export default function RelatedPosts({
  authorActor,
  excludePostId,
  external = false,
}: RelatedPostsProps) {
  const { data, status } = useQuery({
    queryFn: async () => {
      if (external) {
        const collected: PostData[] = [];
        const seenIds = new Set<string>([excludePostId]);

        // 1. Try author posts if authorActor is provided
        if (authorActor) {
          try {
            const params = new URLSearchParams({
              actor: authorActor,
              limit: "10",
              tab: "posts",
            });
            const response = await fetch(
              `/api/protocols/bluesky/profile?${params.toString()}`
            );
            if (response.ok) {
              const payload = (await response.json()) as {
                items?: ExternalPost[];
              };
              for (const item of payload.items ?? []) {
                const presented = externalPostView(item);
                if (
                  !seenIds.has(presented.id) &&
                  (!presented.external || !seenIds.has(presented.external.id))
                ) {
                  seenIds.add(presented.id);
                  if (presented.external) {
                    seenIds.add(presented.external.id);
                  }
                  collected.push(presented);
                }
              }
            }
          } catch {
            // Best-effort, fall through to discovery
          }
        }

        // 2. If author has few or no posts, fill with popular Bluesky discovery
        if (collected.length < 4) {
          try {
            const response = await fetch(
              "/api/protocols/bluesky/discover?mode=personalized"
            );
            if (response.ok) {
              const payload = (await response.json()) as {
                items?: ExternalPost[];
              };
              for (const item of payload.items ?? []) {
                const presented = externalPostView(item);
                if (
                  !seenIds.has(presented.id) &&
                  (!presented.external || !seenIds.has(presented.external.id))
                ) {
                  seenIds.add(presented.id);
                  if (presented.external) {
                    seenIds.add(presented.external.id);
                  }
                  collected.push(presented);
                }
              }
            }
          } catch {
            // Best-effort
          }
        }

        return { posts: collected };
      }

      const result = await kyInstance
        .get(`/api/posts/${excludePostId}/related`)
        .json<{ posts: PostData[] }>();
      return result;
    },
    queryKey: [
      "related-posts",
      external ? `external:${authorActor ?? "discover"}` : "native",
      excludePostId,
    ],
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    staleTime: 60 * 1000,
  });

  const posts = useMemo(
    () =>
      (data?.posts || []).filter(
        (post) =>
          post.id !== excludePostId &&
          (!post.external || post.external.id !== excludePostId)
      ),
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
