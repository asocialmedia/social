import { Separator } from "@asm/ui/shadui/separator";
import { Skeleton } from "@asm/ui/shadui/skeleton";

const PostCardSkeleton = () => (
  <div className="p-4">
    <div className="flex gap-3">
      <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1">
        <div className="relative flex items-start gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2 pr-16 text-sm">
            <Skeleton className="h-4 w-28 shrink-0" />
            <Skeleton className="h-4 w-20 shrink-0" />
            <Skeleton className="h-3 w-3 shrink-0 rounded-full" />
            <Skeleton className="h-3 w-16 shrink-0" />
          </div>
          <div className="absolute top-0 right-0 flex items-center gap-1.5">
            <Skeleton className="h-6 w-6 rounded-full" />
            <Skeleton className="h-6 w-6 rounded-full" />
          </div>
        </div>

        <div className="mt-2.5 space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>

        <div className="mt-2.5">
          <Skeleton className="h-56 w-full rounded-lg" />
        </div>

        <div className="mt-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <Skeleton className="h-8 w-16 rounded-full" />
            <Skeleton className="h-8 w-16 rounded-full" />
            <Skeleton className="h-8 w-16 rounded-full" />
            <Skeleton className="h-8 w-16 rounded-full" />
          </div>
          <div className="flex items-center gap-1">
            <Skeleton className="h-8 w-14 rounded-full" />
            <Skeleton className="h-8 w-8 rounded-full" />
            <Skeleton className="h-8 w-8 rounded-full" />
          </div>
        </div>
      </div>
    </div>
  </div>
);

export default function FeedViewSkeleton() {
  return (
    <div className="flex flex-col">
      {[1, 2, 3].map((index) => (
        <div key={`feed-skeleton-${index}`}>
          {index > 0 && <Separator className="bg-border/60" />}
          <PostCardSkeleton />
        </div>
      ))}
    </div>
  );
}
