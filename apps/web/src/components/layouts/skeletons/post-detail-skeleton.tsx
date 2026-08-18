import { Skeleton } from "@asm/ui/shadui/skeleton";
import type React from "react";

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

            {/* Detail post card */}
            <div className="p-4">
              <div className="flex gap-3">
                <Skeleton className="h-12 w-12 shrink-0 rounded-full" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1 space-y-2 pr-16">
                      <div className="flex items-center gap-2">
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className="h-3 w-16" />
                      </div>
                      <div className="flex items-center gap-2">
                        <Skeleton className="h-3.5 w-24" />
                        <Skeleton className="h-6 w-14 rounded-full" />
                      </div>
                    </div>
                    <Skeleton className="ml-auto h-6 w-6 shrink-0" />
                  </div>

                  <div className="mt-3 space-y-2">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-5/6" />
                    <Skeleton className="h-4 w-2/3" />
                  </div>

                  <Skeleton className="mt-4 aspect-square w-full rounded-lg sm:aspect-video" />
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between gap-2">
                <div className="flex items-center gap-1">
                  <Skeleton className="h-8 w-16 rounded-full" />
                  <Skeleton className="h-8 w-16 rounded-full" />
                </div>
                <div className="flex items-center gap-1">
                  <Skeleton className="h-8 w-14 rounded-full" />
                  <Skeleton className="h-8 w-8 rounded-full" />
                  <Skeleton className="h-8 w-8 rounded-full" />
                </div>
              </div>
            </div>

            {/* "View more content" heading */}
            <div className="flex items-center justify-between px-4 py-2">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-4 w-24" />
            </div>

            {/* Feed cards */}
            <div className="flex flex-col">
              {[1, 2].map((index) => (
                <FeedCardSkeleton key={`post-feed-${index}`} />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Right rail: mirrors PostAuthorSidebar on the post detail page */}
      <aside className="hide-native-scrollbar border-border/60 sticky top-0 hidden h-screen w-72 shrink-0 flex-col overflow-y-auto border-l px-5 pt-2.5 pb-6 xl:flex">
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

const FeedCardSkeleton: React.FC = () => (
  <div className="p-4">
    <div className="flex gap-3">
      <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 pr-16">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-3 w-3 rounded-full" />
          <Skeleton className="h-3 w-16" />
        </div>
        <div className="mt-2.5 space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
        <div className="mt-2.5">
          <Skeleton className="h-56 w-full rounded-lg sm:h-72" />
        </div>
      </div>
    </div>
  </div>
);
