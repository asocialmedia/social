import { Separator } from "@asm/ui/shadui/separator";
import { Skeleton } from "@asm/ui/shadui/skeleton";

const HnStoryCardSkeleton = () => (
  <div className="flex flex-col gap-1.5 p-3 sm:p-3.5">
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <Skeleton className="h-5 w-5 rounded-md" />
        <Skeleton className="h-3 w-20 rounded-md" />
      </div>
      <div className="flex items-center gap-1">
        <Skeleton className="h-3 w-16 rounded-md" />
        <Skeleton className="h-8 w-8 rounded-full" />
      </div>
    </div>

    <div className="flex items-start justify-between gap-3">
      <Skeleton className="h-4 w-3/4 rounded-md" />
      <Skeleton className="h-4 w-16 shrink-0 rounded-full" />
    </div>

    <div className="mt-0.5 flex items-center gap-1.5">
      <Skeleton className="h-5 w-20 rounded-full" />
      <Skeleton className="h-5 w-16 rounded-full" />
      <Skeleton className="h-5 w-24 rounded-full" />
    </div>

    <div className="mt-0.5 flex items-center gap-1.5 pt-2">
      <Skeleton className="h-6 w-16 rounded-lg" />
      <Skeleton className="h-6 w-12 rounded-lg" />
      <Skeleton className="h-6 w-28 rounded-lg" />
      <Skeleton className="ml-auto h-6 w-14 rounded-lg" />
    </div>
  </div>
);

export default function HnFeedSkeleton() {
  return (
    <div className="flex flex-col">
      {[1, 2, 3].map((index) => (
        <div key={`hn-skeleton-${index}`}>
          {index > 0 && <Separator className="bg-border/60" />}
          <HnStoryCardSkeleton />
        </div>
      ))}
    </div>
  );
}
