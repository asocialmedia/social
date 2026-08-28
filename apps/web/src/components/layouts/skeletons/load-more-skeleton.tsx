import { Skeleton } from "@asm/ui/shadui/skeleton";

// Mirrors the current post-card layout: avatar + header row with the two
// round action buttons, caption lines, a bento-shaped media block (tall left
// tile + stacked right tiles like 3-5 image posts), then the pill action row.
const LoadMoreCardSkeleton = () => (
  <div className="p-4">
    <div className="flex items-start gap-3">
      <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
      <div className="relative min-w-0 flex-1">
        <div className="flex items-center gap-2 pr-16">
          <Skeleton className="h-4 w-28 shrink-0" />
          <Skeleton className="h-4 w-20 shrink-0" />
          <span className="text-muted-foreground shrink-0">·</span>
          <Skeleton className="h-3 w-14 shrink-0" />
        </div>
        <div className="mt-1 flex items-center gap-2">
          <Skeleton className="h-3.5 w-24" />
        </div>
        <div className="absolute top-0 right-0 flex items-center gap-1.5">
          <Skeleton className="h-8 w-8 rounded-full" />
          <Skeleton className="h-8 w-8 rounded-full" />
        </div>
      </div>
    </div>

    <div className="mt-2.5 space-y-2">
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-3/4" />
    </div>

    {/* Bento-shaped media placeholder: tall left tile, two stacked right. */}
    <div className="mt-2.5 grid grid-cols-2 gap-2">
      <Skeleton className="h-72 rounded-lg" />
      <div className="flex flex-col gap-2">
        <Skeleton className="h-[138px] rounded-lg" />
        <Skeleton className="h-[138px] rounded-lg" />
      </div>
    </div>

    <div className="mt-3 flex items-center justify-between gap-2">
      <div className="flex items-center gap-1.5">
        <Skeleton className="h-8 w-20 rounded-full" />
        <Skeleton className="h-8 w-14 rounded-full" />
      </div>
      <div className="flex items-center gap-1.5">
        <Skeleton className="h-8 w-16 rounded-full" />
        <Skeleton className="h-8 w-8 rounded-full" />
        <Skeleton className="h-8 w-8 rounded-full" />
      </div>
    </div>
  </div>
);

export default function LoadMoreSkeleton() {
  return (
    <div className="flex flex-col">
      {[1, 2].map((index) => (
        <div
          className="border-border/60 border-b bg-[hsl(var(--background-alt))]"
          key={`load-more-${index}`}
        >
          <LoadMoreCardSkeleton />
        </div>
      ))}
    </div>
  );
}
