import { Skeleton } from "@asm/ui/shadui/skeleton";

const ExploreUserRowSkeleton: React.FC = () => (
  <div className="flex items-start gap-3 px-4 py-3">
    <Skeleton className="h-11 w-11 shrink-0 rounded-xl" />
    <div className="min-w-0 flex-1 pt-0.5">
      <div className="flex items-center gap-2">
        <Skeleton className="h-4 w-28 rounded-md" />
        <Skeleton className="h-3.5 w-16 rounded-md" />
      </div>
      <Skeleton className="mt-2 h-3.5 w-3/4 rounded-md" />
      <div className="mt-2 flex gap-3">
        <Skeleton className="h-3 w-14 rounded-md" />
        <Skeleton className="h-3 w-12 rounded-md" />
        <Skeleton className="h-3 w-10 rounded-md" />
      </div>
    </div>
    <Skeleton className="h-8 w-20 shrink-0 rounded-full" />
  </div>
);

const ExploreUsersSkeleton: React.FC = () => (
  <div className="flex flex-col">
    {[1, 2, 3, 4, 5].map((index) => (
      <ExploreUserRowSkeleton key={`explore-skeleton-${index}`} />
    ))}
  </div>
);

export default ExploreUsersSkeleton;
