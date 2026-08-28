import { Skeleton } from "@asm/ui/shadui/skeleton";
import type React from "react";

// Compact card placeholder: banner strip, overlapping avatar, name +
// @username lines, two-line bio, reason line, follower/aura stats, then a
// full-width follow pill. `highlight` mirrors the amber recommended panel.
export const UserCardSkeleton: React.FC<{ highlight?: boolean }> = ({
  highlight = false,
}) => (
  <div
    className={`mb-4 flex flex-col overflow-hidden rounded-2xl ${
      highlight ? "hn-story-solid" : "sidebar-subcard"
    }`}
  >
    <div className="relative h-20 w-full shrink-0">
      <Skeleton className="h-full w-full rounded-none" />
    </div>
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

// Mirrors the People tab body: search bar, header row with the 3D refresh
// pill, then one masonry stream whose first cards carry the highlighted
// Recommended treatment.
const STREAM_KEYS = [
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
      <div className="mb-3 flex items-center justify-between">
        <Skeleton className="h-4 w-40 rounded-md" />
        <Skeleton className="rail-3d-btn h-9 w-28 rounded-full" />
      </div>
    ) : null}
    <div className="columns-1 gap-4 sm:columns-2 lg:columns-3 xl:columns-4">
      {STREAM_KEYS.map((key, index) => (
        <UserCardSkeleton
          highlight={variant === "discovery" && index < 5}
          key={key}
        />
      ))}
    </div>
  </div>
);

export default ExplorePeopleSkeleton;
