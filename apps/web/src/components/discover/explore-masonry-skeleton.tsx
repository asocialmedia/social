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

const PostSkeleton: React.FC<{ aspect: number }> = ({ aspect }) => (
  <div className="sidebar-subcard mb-4 break-inside-avoid rounded-2xl p-3">
    <Skeleton className="w-full rounded-xl" style={{ aspectRatio: aspect }} />
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
);

const UserSkeleton: React.FC = () => (
  <div className="sidebar-subcard mb-4 break-inside-avoid rounded-2xl">
    <Skeleton className="h-20 w-full rounded-none" />
    <div className="p-3">
      <Skeleton className="-mt-9 h-11 w-11 rounded-xl" />
      <div className="mt-2 space-y-1.5">
        <Skeleton className="h-4 w-2/3 rounded-md" />
        <Skeleton className="h-3 w-1/2 rounded-md" />
      </div>
      <Skeleton className="mt-2 h-3.5 w-full rounded-md" />
      <div className="mt-2 flex gap-3">
        <Skeleton className="h-3 w-14 rounded-md" />
        <Skeleton className="h-3 w-12 rounded-md" />
      </div>
      <Skeleton className="mt-3 h-8 w-full rounded-full" />
    </div>
  </div>
);

const ExploreMasonrySkeleton: React.FC = () => (
  <div className="columns-2 gap-4 p-4 sm:columns-3 xl:columns-4">
    {KEYS.map((key, index) =>
      index === 4 || index === 9 ? (
        <UserSkeleton key={key} />
      ) : (
        <PostSkeleton aspect={ASPECTS[index]} key={key} />
      )
    )}
  </div>
);

export default ExploreMasonrySkeleton;
