import { Skeleton } from "@asm/ui/shadui/skeleton";

import FeedViewSkeleton from "./feed-view-skeleton";

// Mirrors the three-column app chrome (left sidebar / feed / right rail) so the
// route-group loading state and page-level Suspense fallbacks share one honest
// skeleton instead of a full-screen overlay.
const SidebarNavSkeleton = () => (
  <div className="flex flex-col gap-1.5">
    {Array.from({ length: 6 }).map((_, index) => (
      <Skeleton
        className="h-11 w-full rounded-full"
        key={`sidebar-nav-${index}`}
      />
    ))}
  </div>
);

const RightRailSkeleton = () => (
  <div className="flex flex-col gap-4">
    <Skeleton className="h-28 w-full rounded-xl" />
    <Skeleton className="h-40 w-full rounded-xl" />
    <Skeleton className="h-24 w-full rounded-xl" />
  </div>
);

export default function AppShellSkeleton() {
  return (
    <div aria-hidden className="relative flex h-dvh overflow-hidden">
      <aside className="border-border/60 hidden w-72 shrink-0 flex-col gap-6 border-r px-5 pt-3 pb-5 lg:flex">
        <Skeleton className="h-11 w-14 rounded-xl" />
        <SidebarNavSkeleton />
        <div className="mt-auto space-y-3">
          <Skeleton className="h-12 w-full rounded-full" />
          <Skeleton className="h-12 w-full rounded-full" />
        </div>
      </aside>

      <div className="border-border/60 mx-auto flex min-w-0 flex-1 flex-col bg-[hsl(var(--background-alt))] sm:border-x lg:max-w-5xl">
        <div className="border-border/60 border-b p-4">
          <Skeleton className="h-9 w-48 rounded-full" />
        </div>
        <FeedViewSkeleton />
      </div>

      <aside className="border-border/60 hidden w-72 shrink-0 flex-col gap-4 border-l px-5 pt-6 pb-5 xl:flex">
        <RightRailSkeleton />
      </aside>
    </div>
  );
}
