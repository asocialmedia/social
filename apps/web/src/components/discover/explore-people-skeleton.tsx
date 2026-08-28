import { Skeleton } from "@asm/ui/shadui/skeleton";
import type React from "react";

// Matches the compact ExploreUserCard shape: banner strip, overlapping
// avatar block, name + @username lines, a two-line bio, follower/aura stats,
// then a full-width follow-button pill.
export const UserCardSkeleton: React.FC<{ bannerHeight?: string }> = ({
  bannerHeight = "h-20",
}) => (
  <div className="sidebar-subcard flex h-full flex-col overflow-hidden rounded-2xl">
    <Skeleton className={`${bannerHeight} w-full rounded-none`} />
    <div className="flex flex-1 flex-col p-3">
      <Skeleton className="-mt-9 h-11 w-11 rounded-xl" />
      <div className="mt-2 space-y-1.5">
        <Skeleton className="h-4 w-2/3 rounded-md" />
        <Skeleton className="h-3 w-1/2 rounded-md" />
      </div>
      <Skeleton className="mt-2 h-3.5 w-full rounded-md" />
      <Skeleton className="mt-1.5 h-3.5 w-5/6 rounded-md" />
      <div className="mt-2 flex items-center gap-3">
        <Skeleton className="h-3 w-14 rounded-md" />
        <Skeleton className="h-3 w-12 rounded-md" />
      </div>
      <div className="mt-auto pt-3">
        <Skeleton className="h-8 w-full rounded-full" />
      </div>
    </div>
  </div>
);

// The featured "recommended" card: wide banner, overlapping avatar, name
// block, reason line, stats and a right-aligned follow pill.
const FeaturedCardSkeleton: React.FC = () => (
  <div className="sidebar-subcard mb-4 overflow-hidden rounded-2xl">
    <Skeleton className="h-28 w-full rounded-none sm:h-32" />
    <div className="p-4">
      <div className="flex items-end gap-4">
        <Skeleton className="-mt-12 h-16 w-16 rounded-2xl" />
        <div className="min-w-0 flex-1 space-y-2 pb-1">
          <Skeleton className="h-4 w-1/3 rounded-md" />
          <Skeleton className="h-3 w-1/4 rounded-md" />
        </div>
        <Skeleton className="hidden h-9 w-28 rounded-full sm:block" />
      </div>
      <div className="mt-3 space-y-2">
        <Skeleton className="h-3.5 w-2/5 rounded-md" />
        <Skeleton className="h-3.5 w-full rounded-md" />
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Skeleton className="h-3 w-16 rounded-md" />
        <Skeleton className="h-3 w-14 rounded-md" />
        <Skeleton className="ml-auto h-9 w-28 rounded-full sm:hidden" />
      </div>
    </div>
  </div>
);

// Mirrors the People tab body: the search bar, the featured recommended
// card, then the discovery grid of everyone else. The top bar + tabs live
// above this in the page shell, so the skeleton only covers the scroll body.
const GRID_KEYS = [
  "people-skel-1",
  "people-skel-2",
  "people-skel-3",
  "people-skel-4",
  "people-skel-5",
  "people-skel-6",
  "people-skel-7",
  "people-skel-8",
];

const ExplorePeopleSkeleton: React.FC<{ variant?: "discovery" | "search" }> = ({
  variant = "discovery",
}) => (
  <div className="p-4">
    <div className="relative mb-4">
      <Skeleton className="h-10 w-full rounded-xl" />
    </div>
    {variant === "discovery" ? (
      <>
        <FeaturedCardSkeleton />
        <div className="mb-3 flex items-center justify-between">
          <Skeleton className="h-4 w-32 rounded-md" />
          <Skeleton className="h-7 w-24 rounded-full" />
        </div>
      </>
    ) : null}
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {GRID_KEYS.map((key) => (
        <UserCardSkeleton key={key} />
      ))}
    </div>
  </div>
);

export default ExplorePeopleSkeleton;
