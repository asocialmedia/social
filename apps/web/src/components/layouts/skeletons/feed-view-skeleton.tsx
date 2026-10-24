import type { FeedSource } from "@asm/protocols/discovery";
import type { PostPreviewSource } from "@asm/ui/lib/post-preview-layout";
import { Separator } from "@asm/ui/shadui/separator";

import { PostCardSkeleton } from "./post-card-skeleton";

export default function FeedViewSkeleton({
  count = 8,
  posts,
  source = "all",
}: {
  count?: number;
  posts?: readonly PostPreviewSource[];
  source?: FeedSource;
} = {}) {
  const items = posts?.length
    ? posts
    : Array.from<undefined>({ length: count });
  return (
    <div
      aria-busy="true"
      aria-label="Loading feed"
      className="flex min-h-dvh flex-col overflow-hidden"
    >
      {items.map((post, index) => {
        const isBluesky =
          source === "bluesky" ||
          (source === "all" && index % 2 === 1) ||
          Boolean(post && "external" in post && post.external);
        return (
          <div className="flex flex-col" key={`feed-skeleton-${index}`}>
            <PostCardSkeleton
              index={index}
              isBluesky={isBluesky}
              post={post}
              source={source}
            />
            <Separator className="bg-border/60" />
          </div>
        );
      })}
    </div>
  );
}
