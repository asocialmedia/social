import { Skeleton } from "@asm/ui/shadui/skeleton";

const ExploreCardSkeleton: React.FC = () => (
  <div className="sidebar-subcard flex h-full flex-col overflow-hidden rounded-2xl">
    <Skeleton className="h-20 w-full shrink-0 rounded-none" />
    <div className="flex flex-1 flex-col gap-3 p-4">
      <Skeleton className="h-12 w-12 rounded-xl" />
      <div className="space-y-1.5">
        <Skeleton className="h-4 w-2/3 rounded-md" />
        <Skeleton className="h-3.5 w-1/2 rounded-md" />
      </div>
      <Skeleton className="h-3.5 w-full rounded-md" />
      <Skeleton className="h-3.5 w-3/4 rounded-md" />
      <div className="flex gap-3">
        <Skeleton className="h-3 w-14 rounded-md" />
        <Skeleton className="h-3 w-12 rounded-md" />
        <Skeleton className="h-3 w-10 rounded-md" />
      </div>
      <Skeleton className="mt-auto h-8 w-full rounded-full" />
    </div>
  </div>
);

const ExploreUsersSkeleton: React.FC = () => (
  <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
    {[1, 2, 3, 4, 5, 6].map((index) => (
      <ExploreCardSkeleton key={`explore-skeleton-${index}`} />
    ))}
  </div>
);

export default ExploreUsersSkeleton;
