"use client";

import { Skeleton } from "@asm/ui/shadui/skeleton";

import { ExploreMasonry } from "./explore-masonry";

export function ExploreGustsSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading Gusts" className="p-4">
      <ExploreMasonry scope="gusts-loading">
        {Array.from({ length: count }, (_, index) => (
          <div
            className="relative aspect-9/16 overflow-hidden rounded-2xl"
            key={`gust-skeleton-${index}`}
          >
            <Skeleton className="absolute inset-0 size-full rounded-2xl" />
            <div className="absolute inset-x-3 bottom-4 space-y-3">
              <div className="flex items-center gap-2">
                <Skeleton className="size-8 rounded-xl" />
                <Skeleton className="h-3 w-1/2" />
              </div>
              <Skeleton className="h-3 w-3/4" />
            </div>
          </div>
        ))}
      </ExploreMasonry>
    </div>
  );
}
