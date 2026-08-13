import { Skeleton } from "@asm/ui/shadui/skeleton";

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

const ExploreMasonrySkeleton: React.FC = () => (
  <div className="columns-2 gap-4 p-4 sm:columns-3 xl:columns-4">
    {KEYS.map((key, index) => (
      <div
        className="sidebar-subcard mb-4 break-inside-avoid rounded-2xl p-3"
        key={key}
      >
        <Skeleton
          className="w-full rounded-xl"
          style={{ aspectRatio: ASPECTS[index] }}
        />
        <div className="mt-3 space-y-2">
          <Skeleton className="h-3.5 w-full rounded-md" />
          <Skeleton className="h-3.5 w-3/4 rounded-md" />
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Skeleton className="h-6 w-6 rounded-full" />
          <Skeleton className="h-3 w-20 rounded-md" />
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Skeleton className="h-8 w-8 rounded-full" />
          <Skeleton className="h-8 w-8 rounded-full" />
          <Skeleton className="h-8 w-16 rounded-full" />
        </div>
      </div>
    ))}
  </div>
);

export default ExploreMasonrySkeleton;
