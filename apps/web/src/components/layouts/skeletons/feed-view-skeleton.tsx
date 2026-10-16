import type { PostPreviewSource } from "@asm/ui/lib/post-preview-layout";
import { Separator } from "@asm/ui/shadui/separator";

import { PostCardSkeleton } from "./post-card-skeleton";

export default function FeedViewSkeleton({
  posts,
}: { posts?: readonly PostPreviewSource[] } = {}) {
  return (
    <div className="flex flex-col">
      {(posts?.length ? posts : [undefined, undefined, undefined]).map(
        (post, index) => (
          <div key={`feed-skeleton-${index}`}>
            {index > 0 ? <Separator className="bg-border/60" /> : null}
            <PostCardSkeleton post={post} />
          </div>
        )
      )}
    </div>
  );
}
