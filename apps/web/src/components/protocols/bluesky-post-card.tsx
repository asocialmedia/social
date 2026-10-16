"use client";

import type { ExternalPost } from "@asm/protocols/contracts";
import { useMemo } from "react";

import PostCard from "@/components/home/feedview/post-card";
import { externalPostView } from "@/lib/posts/presentation";

export { BlueskyIcon } from "./bluesky-icon";

export function BlueskyPostCard({
  post,
  detail = false,
}: {
  post: ExternalPost;
  detail?: boolean;
}) {
  const presentation = useMemo(() => externalPostView(post), [post]);
  return <PostCard detail={detail} post={presentation} />;
}
