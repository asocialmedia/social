"use client";

import { Skeleton } from "@asm/ui/shadui/skeleton";
import { useLayoutEffect, useRef, useState } from "react";
import type { ReactElement } from "react";

import { placeExploreItems } from "@/lib/recommendations/explore-masonry";

// Separate columns never rebalance already visible cards when either network appends a page.
export function ExploreMasonry({
  children,
  scope,
  loading = false,
}: {
  children: readonly ReactElement[];
  scope: string;
  loading?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState(2);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) {
      return;
    }
    const measure = () =>
      setCount(
        Math.max(2, Math.min(4, Math.floor((element.clientWidth + 16) / 200)))
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const items = children;
  const byId = new Map(items.map((item) => [String(item.key), item]));
  const ids = [...byId.keys()];
  const signature = JSON.stringify([scope, count, ids]);
  const [layout, setLayout] = useState(() => ({
    columns: placeExploreItems([], ids, count),
    scope,
    signature,
  }));
  let { columns } = layout;
  if (layout.signature !== signature) {
    columns = placeExploreItems(
      layout.scope === scope ? layout.columns : [],
      ids,
      count
    );
    setLayout({ columns, scope, signature });
  }
  let className = "grid grid-cols-2 items-start gap-4";
  if (count === 3) {
    className = "grid grid-cols-3 items-start gap-4";
  }
  if (count === 4) {
    className = "grid grid-cols-4 items-start gap-4";
  }
  return (
    <div className={className} data-explore-masonry ref={root}>
      {columns.map((column, index) => (
        <div
          className={index % 2 ? "min-w-0 space-y-4 pt-5" : "min-w-0 space-y-4"}
          data-masonry-column={index}
          key={`column-${index}`}
        >
          {column.map((id) => (
            <div
              className="min-w-0 [&>article]:mb-0! [&>div>article]:mb-0!"
              data-masonry-item={id}
              key={id}
            >
              {byId.get(id)}
            </div>
          ))}
          {loading ? (
            <div
              aria-busy="true"
              aria-label="Loading more recommendations"
              className="space-y-4"
            >
              {[0, 1].map((placeholder) => (
                <div
                  className="surface-3d overflow-hidden rounded-2xl!"
                  key={placeholder}
                >
                  <Skeleton className="aspect-4/5 w-full rounded-none" />
                  <div className="space-y-2.5 p-3">
                    <Skeleton className="h-3.5 w-full" />
                    <Skeleton className="h-3.5 w-2/3" />
                    <Skeleton className="h-8 w-24" />
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
