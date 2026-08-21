import { Skeleton } from "@asm/ui/shadui/skeleton";

// Mirrors the explore page structure exactly: the "Trending Gusts" rail (a
// sidebar-subcard with a header + horizontal row of 9:16 gust tiles) followed
// by the masonry of interleaved post cards and user cards. The top bar + tabs
// render above this in explore-client, so this only mirrors the scroll body.
const ASPECTS = [4 / 5, 3 / 4, 1, 4 / 5, 3 / 4, 1, 4 / 5, 3 / 4, 1, 4 / 5];

const KEYS = [
  "explore-skeleton-a",
  "explore-skeleton-b",
  "explore-skeleton-c",
  "explore-skeleton-d",
  "explore-skeleton-e",
  "explore-skeleton-f",
  "explore-skeleton-g",
  "explore-skeleton-h",
  "explore-skeleton-i",
  "explore-skeleton-j",
];

const GustRailSkeleton: React.FC = () => (
  <section className="sidebar-subcard mb-6 overflow-hidden rounded-2xl">
    {/* Header */}
    <div className="flex items-center justify-between gap-3 px-4 pt-3.5 pb-2.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <Skeleton className="size-4.5 rounded-full" />
        <Skeleton className="h-4 w-28 rounded-md" />
      </div>
      <Skeleton className="h-4 w-16 rounded-md" />
    </div>
    {/* Horizontal row of 9:16 gust tiles */}
    <div className="flex gap-3 overflow-hidden px-4 pb-4">
      {[0, 1, 2, 3].map((index) => (
        <div className="w-28 shrink-0 sm:w-36" key={`gust-rail-${index}`}>
          <Skeleton className="aspect-[9/16] w-full rounded-2xl" />
        </div>
      ))}
    </div>
  </section>
);

// Matches the real ExplorePostCard: media block (with a small gust badge chip),
// content lines, an author row (avatar + name/@username), then the vote pill.
const PostSkeleton: React.FC<{ aspect: number; isGust?: boolean }> = ({
  aspect,
  isGust = false,
}) => (
  <div className="sidebar-subcard mb-4 break-inside-avoid overflow-hidden rounded-2xl">
    <div className="bg-muted/20 relative w-full overflow-hidden">
      <Skeleton
        className="w-full rounded-none"
        style={{ aspectRatio: aspect }}
      />
      {isGust ? (
        <div className="absolute top-2 left-2 z-10">
          <Skeleton className="h-5 w-14 rounded-full" />
        </div>
      ) : null}
    </div>
    <div className="flex flex-col gap-2.5 p-3">
      <Skeleton className="h-3.5 w-full rounded-md" />
      <Skeleton className="h-3.5 w-3/4 rounded-md" />
      <Skeleton className="h-3.5 w-1/2 rounded-md" />
      <div className="flex items-center gap-2">
        <Skeleton className="h-8 w-8 rounded-full" />
        <div className="min-w-0 flex-1">
          <Skeleton className="h-3 w-24 rounded-md" />
          <Skeleton className="mt-1 h-2.5 w-16 rounded-md" />
        </div>
      </div>
    </div>
    <div className="flex items-center gap-2 px-3 pb-3">
      <Skeleton className="h-8 w-20 rounded-full" />
    </div>
  </div>
);

// Matches the real ExploreUserCard: banner, overlapping avatar, name +
// username, bio line, follower stats, then the follow button.
const UserSkeleton: React.FC = () => (
  <div className="sidebar-subcard mb-4 break-inside-avoid overflow-hidden rounded-2xl">
    <Skeleton className="h-20 w-full rounded-none" />
    <div className="p-3">
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
      <Skeleton className="mt-3 h-8 w-full rounded-full" />
    </div>
  </div>
);

const ExploreMasonrySkeleton: React.FC = () => (
  <div className="p-4">
    <GustRailSkeleton />
    <div className="columns-2 gap-4 sm:columns-3 xl:columns-4">
      {KEYS.map((key, index) =>
        index === 4 || index === 9 ? (
          <UserSkeleton key={key} />
        ) : (
          <PostSkeleton
            aspect={ASPECTS[index]}
            isGust={index === 1}
            key={key}
          />
        )
      )}
    </div>
  </div>
);

export default ExploreMasonrySkeleton;
