import { Skeleton } from "@asm/ui/shadui/skeleton";
import type React from "react";

import MobileBottomNav from "@/components/layouts/navigation/mobile/mobile-bottom-nav";

import FeedViewSkeleton from "./feed-view-skeleton";

// Route/Suspense fallback for /a/[slug]. Mirrors CommunityPage's real output -
// center column (mobile bar, banner header, sort tabs, feed) beside the right
// rail (search, About, People, Top members) - so the page streams into place
// without a blank frame or a layout shift. The feed body reuses the shared
// FeedViewSkeleton, so a community feed and the global feeds show the same card
// shape while loading.

// One placeholder identity row for a rail card (avatar + name over handle),
// matching the People and Top members cards' rows.
const RailRowSkeleton: React.FC = () => (
  <div className="flex animate-pulse items-center gap-2.5 rounded-xl px-2.5 py-2">
    <Skeleton className="size-8 shrink-0 rounded-full" />
    <div className="min-w-0 flex-1 space-y-1.5">
      <Skeleton className="h-3.5 w-3/4 rounded-md" />
      <Skeleton className="h-3 w-1/2 rounded-md" />
    </div>
  </div>
);

// The right rail: the search field, then the About / People / Top members cards
// at the same widths and paddings the live rail uses.
const CommunitySidebarSkeleton: React.FC = () => (
  <aside className="bg-background border-border/60 sticky top-0 z-30 hidden h-screen w-72 shrink-0 flex-col overflow-visible border-l px-2.5 pt-2.5 pb-6 xl:flex">
    <div className="shrink-0 pb-4">
      <Skeleton className="h-12 w-full rounded-xl" />
    </div>

    <div className="flex flex-1 flex-col gap-4">
      {/* About card: mark + name + aura, description, two stat columns. */}
      <div className="sidebar-subcard rounded-2xl p-4">
        <div className="flex items-start gap-3">
          <Skeleton className="size-11 shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1 space-y-1.5 pt-0.5">
            <Skeleton className="h-4 w-28 rounded-md" />
            <Skeleton className="h-3 w-20 rounded-md" />
          </div>
          <Skeleton className="h-4 w-10 shrink-0 rounded-md" />
        </div>
        <div className="mt-3 space-y-1.5">
          <Skeleton className="h-4 w-full rounded-md" />
          <Skeleton className="h-4 w-4/5 rounded-md" />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-x-4">
          <div className="space-y-1">
            <Skeleton className="h-3 w-16 rounded-md" />
            <Skeleton className="h-5 w-10 rounded-md" />
          </div>
          <div className="space-y-1">
            <Skeleton className="h-3 w-20 rounded-md" />
            <Skeleton className="h-5 w-10 rounded-md" />
          </div>
        </div>
        <Skeleton className="mt-4 h-3 w-32 rounded-md" />
      </div>

      {/* People card */}
      <div className="sidebar-subcard rounded-2xl p-2">
        <div className="flex items-center gap-2 px-1.5 pt-1.5 pb-1">
          <Skeleton className="h-4 w-16 rounded-md" />
        </div>
        <div className="flex flex-col gap-0.5">
          {[0, 1, 2, 3].map((index) => (
            <RailRowSkeleton key={`people-sk-${index}`} />
          ))}
        </div>
      </div>

      {/* Top members card */}
      <div className="sidebar-subcard rounded-2xl p-2">
        <div className="flex items-center gap-2 px-1.5 pt-1.5 pb-1">
          <Skeleton className="h-4 w-24 rounded-md" />
        </div>
        <div className="flex flex-col gap-0.5">
          {[0, 1, 2, 3, 4].map((index) => (
            <RailRowSkeleton key={`top-sk-${index}`} />
          ))}
        </div>
      </div>
    </div>
  </aside>
);

export default function CommunityPageSkeleton() {
  return (
    <>
      <div className="relative flex min-w-0 flex-1 overflow-hidden">
        <div className="flex min-w-0 flex-1">
          {/* Center column: same metrics as the live community page. */}
          <div className="border-border/60 mx-auto flex min-w-0 flex-1 flex-col bg-[hsl(var(--background-alt))] sm:border-x lg:max-w-5xl">
            {/* Mobile top bar */}
            <div className="border-border/60 flex items-center gap-2 border-b px-3 py-2 md:hidden">
              <Skeleton className="size-10 shrink-0 rounded-full" />
              <Skeleton className="mx-auto h-6 w-24 rounded-md" />
              <Skeleton className="size-9 shrink-0 rounded-full" />
            </div>

            {/* Banner header */}
            <div
              className="relative h-36 shrink-0 overflow-hidden sm:h-48"
              aria-hidden="true"
            >
              <Skeleton className="h-full w-full rounded-none" />
            </div>
            <div className="px-4 pb-4">
              <div className="relative z-10 -mt-8 flex items-end justify-between gap-3 sm:-mt-10">
                <Skeleton className="size-16 shrink-0 rounded-xl sm:size-20" />
                <Skeleton className="h-8 w-20 shrink-0 rounded-full" />
              </div>
              <div className="mt-3 space-y-1.5">
                <Skeleton className="h-6 w-40 rounded-md" />
                <Skeleton className="h-4 w-48 rounded-md" />
              </div>
            </div>

            {/* Sort tabs */}
            <div className="border-border/60 flex items-center gap-2 border-b px-3 py-3">
              <Skeleton className="h-5 w-12 rounded-md" />
              <Skeleton className="h-5 w-10 rounded-md" />
            </div>

            {/* Feed */}
            <FeedViewSkeleton />
          </div>
        </div>
      </div>

      <CommunitySidebarSkeleton />
      <MobileBottomNav />
    </>
  );
}
