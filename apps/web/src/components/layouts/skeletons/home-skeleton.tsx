import { Skeleton } from "@asm/ui/shadui/skeleton";
import type React from "react";

import FeedViewSkeleton from "./feed-view-skeleton";

// Mirrors the home page layout on desktop: the center feed column (mobile top
// bar + the three feed tabs) beside the full-height right rail. Used as the
// Suspense fallback so navigating back home doesn't flash a narrow center-only
// column with a large empty gap where the right rail sits on xl screens.
const RightRailSkeleton: React.FC = () => (
  <aside className="hide-native-scrollbar bg-background border-border/60 sticky top-0 hidden h-screen w-72 shrink-0 flex-col overflow-y-auto border-l px-2.5 pt-2.5 pb-6 xl:flex">
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-12 w-full rounded-xl" />
        <Skeleton className="h-12 w-full rounded-xl" />
        <Skeleton className="h-12 w-full rounded-xl" />
      </div>
      <Skeleton className="h-40 w-full rounded-xl" />
      <Skeleton className="h-32 w-full rounded-xl" />
    </div>
  </aside>
);

export default function HomePageSkeleton() {
  return (
    <>
      {/* Center feed column */}
      <div className="border-border/60 mx-auto flex min-w-0 flex-1 flex-col bg-[hsl(var(--background-alt))] sm:border-x lg:max-w-5xl">
        <div className="z-20 shrink-0 bg-[hsl(var(--background-alt))]/90 pt-2 backdrop-blur-md">
          <div className="border-border/60 flex items-center justify-center py-3 sm:justify-start">
            <div className="flex items-center gap-4">
              <Skeleton className="h-8 w-20 rounded-full" />
              <Skeleton className="h-8 w-16 rounded-full" />
              <Skeleton className="h-8 w-20 rounded-full" />
            </div>
          </div>
        </div>

        <FeedViewSkeleton />
      </div>

      {/* Right rail */}
      <RightRailSkeleton />
    </>
  );
}
