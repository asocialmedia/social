"use client";

import type { ExternalPost } from "@asm/protocols/contracts";
import { useMemo } from "react";

import PostCard from "@/components/home/feedview/post-card";
import { RecommendationTracker } from "@/components/recommendations/recommendation-tracker";
import { externalPostView } from "@/lib/posts/presentation";

export { BlueskyIcon } from "./bluesky-icon";

export function BlueskyPostCard({
  post,
  detail = false,
  isJoined = true,
}: {
  post: ExternalPost;
  detail?: boolean;
  isJoined?: boolean;
}) {
  const presentation = useMemo(() => externalPostView(post), [post]);
  return (
    <RecommendationTracker
      networkSource={post.source}
      networkToken={post.networkRecommendationToken}
      postId={post.id}
    >
      <PostCard detail={detail} isJoined={isJoined} post={presentation} />
    </RecommendationTracker>
  );
}
