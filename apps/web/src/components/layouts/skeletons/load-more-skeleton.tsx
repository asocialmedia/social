import type { PostPreviewSource } from "@asm/ui/lib/post-preview-layout";

import { PostCardSkeleton } from "./post-card-skeleton";

export default function LoadMoreSkeleton({
  posts,
}: { posts?: readonly PostPreviewSource[] } = {}) {
  return (
    <div className="flex flex-col">
      {(posts?.length ? posts : [undefined, undefined]).map((post, index) => (
        <div
          className="border-border/60 border-b bg-[hsl(var(--background-alt))]"
          key={`load-more-${index}`}
        >
          <PostCardSkeleton post={post} />
        </div>
      ))}
    </div>
  );
}
