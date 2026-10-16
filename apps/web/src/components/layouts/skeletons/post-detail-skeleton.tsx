import { Skeleton } from "@asm/ui/shadui/skeleton";

import { CachedPostCardSkeleton } from "./cached-post-card-skeleton";
import { PostCardSkeleton } from "./post-card-skeleton";

// Mirrors the post detail page exactly: back button + "Post" title, then the
// detail PostCard (avatar, name/username/follow, content, media, action row),
// then the "View more content" heading followed by a few feed cards. This runs
// as the Suspense fallback for both /posts/[id] and /posts/[id]/media/[index],
// so it must match what actually renders once the post streams in.
export default function PostDetailSkeleton() {
  return (
    <>
      <div className="border-border/60 mx-auto flex h-full min-w-0 flex-1 flex-col bg-[hsl(var(--background-alt))] sm:border-x lg:max-w-5xl">
        <div className="relative min-h-0 flex-1">
          <div className="hide-native-scrollbar h-full overflow-x-hidden overflow-y-auto pb-24 lg:pb-20">
            {/* Back button + title */}
            <div className="flex shrink-0 items-center gap-2 bg-[hsl(var(--background-alt))] px-3 py-2">
              <Skeleton className="h-9 w-9 rounded-full" />
              <Skeleton className="h-5 w-12" />
            </div>

            <CachedPostCardSkeleton />

            {/* "View more content" heading */}
            <div className="flex items-center justify-between px-4 py-2">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-4 w-24" />
            </div>

            {/* Feed cards */}
            <div className="flex flex-col">
              {[1, 2].map((index) => (
                <PostCardSkeleton key={`post-feed-${index}`} />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Right rail: mirrors PostAuthorSidebar on the post detail page */}
      <aside className="hide-native-scrollbar bg-background border-border/60 sticky top-0 hidden h-screen w-72 shrink-0 flex-col overflow-y-auto border-l px-2.5 pt-2.5 pb-6 xl:flex">
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2.5 px-2.5 py-2">
            <Skeleton className="h-12 w-12 shrink-0 rounded-lg" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-full" />
              <Skeleton className="h-3.5 w-3/4" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
          <Skeleton className="h-40 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
      </aside>
    </>
  );
}
