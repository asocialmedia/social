import { useEffect } from "react";
import type { RefObject } from "react";

// Scroll geometry also covers a fast swipe straight into the pending snap slot.
export function useGustPagination(options: {
  activeIndex: number;
  canFetchNextPage: boolean;
  containerRef: RefObject<HTMLDivElement | null>;
  delayMs: number;
  fetchNextPage: () => Promise<unknown>;
  isFetchingNextPage: boolean;
  loadedPages: number;
  scope: string;
  visiblePosts: number;
}) {
  const {
    activeIndex,
    canFetchNextPage,
    containerRef,
    delayMs,
    fetchNextPage,
    isFetchingNextPage,
    loadedPages,
    scope,
    visiblePosts,
  } = options;
  useEffect(() => {
    if (!scope || !loadedPages || !canFetchNextPage || isFetchingNextPage) {
      return;
    }
    const container = containerRef.current;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      const nearEnd =
        visiblePosts - activeIndex <= 24 ||
        Boolean(
          container &&
          container.clientHeight > 0 &&
          container.scrollHeight -
            container.scrollTop -
            container.clientHeight <=
            container.clientHeight * 12
        );
      if (!nearEnd) {
        clearTimeout(timer);
        timer = undefined;
      } else if (timer === undefined) {
        timer = setTimeout(async () => {
          timer = undefined;
          // The source queries retain their error and explicit retry controls.
          try {
            await fetchNextPage();
          } catch {
            // Query state exposes the source failure and retry control.
          }
        }, delayMs);
      }
    };
    update();
    container?.addEventListener("scroll", update, { passive: true });
    return () => {
      clearTimeout(timer);
      container?.removeEventListener("scroll", update);
    };
  }, [
    activeIndex,
    canFetchNextPage,
    containerRef,
    delayMs,
    fetchNextPage,
    isFetchingNextPage,
    loadedPages,
    scope,
    visiblePosts,
  ]);
}
