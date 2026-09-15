import { Skeleton } from "@asm/ui/shadui/skeleton";
import type React from "react";

// Page-level fallback for /communities. Mirrors the real layout so the swap to
// live content does not shift anything: the sticky category strip, the compact
// hero statement with its action, the search field, the curated rails, and the
// browse grid, plus the right rail on xl screens.

// One community card, matching CommunityCard's box: tall banner header, the
// overlapping mark, name + a/slug with the open affordance, a two-line
// description well, and the bordered stat row.
const CommunityCardSkeleton: React.FC = () => (
  <div className="sidebar-subcard flex flex-col overflow-hidden rounded-2xl">
    <Skeleton className="h-36 w-full rounded-none" />
    <div className="flex flex-1 flex-col px-5 pb-5">
      <div className="-mt-10">
        <Skeleton className="size-18 rounded-xl" />
      </div>
      <div className="mt-3 flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-1.5">
          <Skeleton className="h-6 w-32 rounded-md" />
          <Skeleton className="h-3.5 w-20 rounded-md" />
        </div>
        <Skeleton className="mt-1 size-4 rounded-sm" />
      </div>
      <div className="mt-2 space-y-1.5">
        <Skeleton className="h-4 w-full rounded-md" />
        <Skeleton className="h-4 w-4/5 rounded-md" />
      </div>
      <div className="border-border/60 mt-3.5 flex items-center gap-5 border-t pt-3.5">
        <Skeleton className="h-4 w-12 rounded-md" />
        <Skeleton className="h-4 w-12 rounded-md" />
        <Skeleton className="h-4 w-12 rounded-md" />
      </div>
    </div>
  </div>
);

// A curated rail: the heading line (filled icon + title) and a track of cards
// at the same width the real rail uses, so nothing reflows on load.
const CommunityRailSkeleton: React.FC<{ cards?: number }> = ({ cards = 4 }) => (
  <section className="relative">
    <div className="mb-3 flex items-center gap-2.5 px-5 sm:px-8">
      <Skeleton className="size-5 rounded-md" />
      <Skeleton className="h-5 w-40 rounded-md" />
    </div>
    <div className="flex gap-4 overflow-hidden px-5 sm:px-8">
      {Array.from({ length: cards }).map((_, index) => (
        <div className="community-card-w shrink-0" key={`rail-card-${index}`}>
          <CommunityCardSkeleton />
        </div>
      ))}
    </div>
  </section>
);

const CommunitiesPageSkeleton: React.FC = () => (
  <>
    <div className="communities-cq border-border/60 flex min-w-0 flex-1 flex-col bg-[hsl(var(--background-alt))] sm:border-x">
      {/* Mobile top bar */}
      <Skeleton className="h-12 w-full shrink-0 rounded-none lg:hidden" />

      {/* Sticky category strip */}
      <div className="flex shrink-0 gap-1.5 px-5 py-2.5 sm:px-8">
        {["w-16", "w-24", "w-32", "w-20", "w-28", "w-36", "w-24", "w-20"].map(
          (width, index) => (
            <Skeleton
              className={`h-8 shrink-0 rounded-lg ${width}`}
              key={`cat-${index}`}
            />
          )
        )}
      </div>

      {/* Hero statement + action, then the search field */}
      <div className="px-5 pt-8 pb-6 sm:px-8">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-5">
          <div className="min-w-0 space-y-2.5">
            <Skeleton className="h-8 w-52 rounded-md sm:h-10 sm:w-64" />
            <Skeleton className="h-8 w-44 rounded-md sm:h-10 sm:w-56" />
            <Skeleton className="h-4 w-72 max-w-full rounded-md" />
          </div>
          <div className="flex shrink-0 flex-col items-start gap-3 sm:items-end">
            <Skeleton className="h-4 w-40 rounded-md" />
            <Skeleton className="h-11 w-44 rounded-lg" />
          </div>
        </div>
      </div>
      <div className="px-5 pb-8 sm:px-8">
        <Skeleton className="h-12 w-full rounded-[14px]" />
      </div>

      {/* Curated rails */}
      <div className="flex flex-col gap-8 pb-8">
        <CommunityRailSkeleton />
        <CommunityRailSkeleton />
      </div>
      <div className="pt-8 pb-9">
        <CommunityRailSkeleton cards={3} />
      </div>

      {/* Browse grid */}
      <div className="px-5 pb-10 sm:px-8">
        <div className="mb-3 flex items-center gap-2.5">
          <Skeleton className="size-5 rounded-md" />
          <Skeleton className="h-5 w-36 rounded-md" />
        </div>
        <Skeleton className="mb-3 h-4 w-28 rounded-md" />
        <div className="community-grid">
          {Array.from({ length: 8 }).map((_, index) => (
            <CommunityCardSkeleton key={`grid-card-${index}`} />
          ))}
        </div>
      </div>
    </div>

    {/* Right rail */}
    <aside className="hide-native-scrollbar bg-background border-border/60 sticky top-0 hidden h-screen w-72 shrink-0 flex-col overflow-y-auto border-l px-2.5 pt-2.5 pb-6 xl:flex">
      <div className="flex flex-col gap-4">
        <Skeleton className="h-11 w-full rounded-xl" />
        <Skeleton className="h-36 w-full rounded-2xl" />
      </div>
    </aside>
  </>
);

export default CommunitiesPageSkeleton;
