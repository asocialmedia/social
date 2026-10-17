"use client";

import type { FeedSource } from "@asm/protocols/discovery";
import type { PostPreviewSource } from "@asm/ui/lib/post-preview-layout";
import { Separator } from "@asm/ui/shadui/separator";
import { useEffect, useState } from "react";

import {
  DYNAMIC_SKELETON_PROFILES,
  PostCardSkeleton,
} from "./post-card-skeleton";

export default function LoadMoreSkeleton({
  count = 4,
  dynamic = true,
  posts,
  rotate = true,
  rotateIntervalMs = 2400,
  source = "all",
}: {
  count?: number;
  dynamic?: boolean;
  posts?: readonly PostPreviewSource[];
  rotate?: boolean;
  rotateIntervalMs?: number;
  source?: FeedSource;
} = {}) {
  const [cycle, setCycle] = useState(0);

  useEffect(() => {
    if (
      !rotate ||
      !dynamic ||
      (posts && posts.length > 0) ||
      (typeof window !== "undefined" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches)
    ) {
      return;
    }
    const timer = setInterval(() => {
      setCycle((prev) => (prev + 1) % DYNAMIC_SKELETON_PROFILES.length);
    }, rotateIntervalMs);
    return () => clearInterval(timer);
  }, [dynamic, posts, rotate, rotateIntervalMs]);

  const items = posts?.length
    ? posts
    : Array.from<undefined>({ length: count });

  return (
    <div
      aria-busy="true"
      aria-label={
        source === "bluesky" ? "Loading Bluesky posts" : "Loading more posts"
      }
      className="flex flex-col overflow-hidden"
    >
      {items.map((post, index) => {
        const isBluesky =
          source === "bluesky" ||
          (source === "all" && index % 2 === 1) ||
          Boolean(post && "external" in post && post.external);
        const profile =
          !post && dynamic
            ? DYNAMIC_SKELETON_PROFILES[
                (index + cycle) % DYNAMIC_SKELETON_PROFILES.length
              ]
            : undefined;
        return (
          <div
            className="flex flex-col transition-all duration-500 ease-in-out"
            key={`load-more-${index}`}
          >
            <PostCardSkeleton
              dynamic={dynamic}
              index={index}
              isBluesky={isBluesky}
              post={post}
              profile={profile}
              source={source}
            />
            <Separator className="bg-border/60" />
          </div>
        );
      })}
    </div>
  );
}
