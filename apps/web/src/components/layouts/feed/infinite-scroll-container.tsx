import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useInView } from "react-intersection-observer";

interface InfiniteScrollContainerProps extends React.PropsWithChildren {
  className?: string;
  prefetchDistance?: number;
  onBottomReached: () => void;
}

// Allow several seconds for a live source to respond before the reader runs out.
const PREFETCH_DISTANCE_PX = 8000;

export default function InfiniteScrollContainer({
  children,
  onBottomReached,
  className,
  prefetchDistance = PREFETCH_DISTANCE_PX,
}: InfiniteScrollContainerProps) {
  const [scrollRoot, setScrollRoot] = useState<HTMLElement | null>();
  const sentinel = useRef<HTMLDivElement | null>(null);
  const { ref: observe, inView } = useInView({
    root: scrollRoot,
    rootMargin: `0px 0px ${prefetchDistance}px 0px`,
    skip: scrollRoot === undefined,
  });

  const attachSentinel = useCallback(
    (node: HTMLDivElement | null) => {
      sentinel.current = node;
      if (node) {
        let parent = node.parentElement;
        while (
          parent &&
          !/(?:auto|scroll)/.test(getComputedStyle(parent).overflowY)
        ) {
          parent = parent.parentElement;
        }
        setScrollRoot(parent);
      }
      observe(node);
    },
    [observe]
  );

  useEffect(() => {
    if (!inView || !sentinel.current || scrollRoot === undefined) {
      return;
    }
    // A newly appended page can move the sentinel before the observer updates.
    // Recheck its position so stale visibility cannot drain every continuation.
    const position = sentinel.current.getBoundingClientRect();
    const viewport = scrollRoot?.getBoundingClientRect();
    if (
      position.top <=
        (viewport?.bottom ?? window.innerHeight) + prefetchDistance &&
      position.bottom >= (viewport?.top ?? 0)
    ) {
      onBottomReached();
    }
  }, [inView, onBottomReached, scrollRoot, prefetchDistance]);

  return (
    <div className={className}>
      {children}
      <div
        aria-hidden="true"
        className="h-px"
        data-feed-sentinel
        ref={attachSentinel}
      />
    </div>
  );
}
