"use client";

import { useEffect } from "react";
import type { RefObject } from "react";

// Mouse and pen drag-to-scroll for a horizontally overflowing strip. Touch is
// already handled natively by the browser with momentum, so this only takes
// over pointer types that cannot pan a scroller. A drag that travels further
// than DRAG_THRESHOLD also swallows the following click, otherwise dragging
// across the tab strip would select whichever tab the pointer happened to
// settle on.
//
// It also marks which edges still have content behind them, so the call site can
// feather the strip instead of slicing a tab label at the boundary.
const DRAG_THRESHOLD = 6;
const EDGE_SLOP = 2;

export function useHorizontalDragScroll(
  containerRef: RefObject<HTMLElement | null>
) {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    let pointerId: number | null = null;
    let startX = 0;
    let startScroll = 0;
    let dragged = false;

    const syncEdges = () => {
      const max = container.scrollWidth - container.clientWidth;
      const overflowing = max > EDGE_SLOP;
      container.toggleAttribute(
        "data-overflow-start",
        overflowing && container.scrollLeft > EDGE_SLOP
      );
      container.toggleAttribute(
        "data-overflow-end",
        overflowing && container.scrollLeft < max - EDGE_SLOP
      );
    };

    const onPointerDown = (event: PointerEvent) => {
      const { button, clientX, pointerType, pointerId: activePointer } = event;
      if (pointerType === "touch" || button !== 0) {
        return;
      }
      if (container.scrollWidth <= container.clientWidth) {
        return;
      }
      pointerId = activePointer;
      startX = clientX;
      startScroll = container.scrollLeft;
      dragged = false;
    };

    const onPointerMove = (event: PointerEvent) => {
      const { clientX, pointerId: activePointer } = event;
      if (pointerId !== activePointer) {
        return;
      }
      const delta = clientX - startX;
      if (!dragged && Math.abs(delta) < DRAG_THRESHOLD) {
        return;
      }
      dragged = true;
      // Pointer capture keeps the drag alive past the strip's edges, so the
      // gesture does not stop the moment the cursor leaves the tabs.
      if (!container.hasPointerCapture(activePointer)) {
        container.setPointerCapture(activePointer);
      }
      // Scroll right when dragging left: content follows the pointer.
      container.scrollLeft = startScroll - delta;
      syncEdges();
      event.preventDefault();
    };

    const endDrag = (event: PointerEvent) => {
      const { pointerId: activePointer } = event;
      if (pointerId !== activePointer) {
        return;
      }
      if (container.hasPointerCapture(activePointer)) {
        container.releasePointerCapture(activePointer);
      }
      pointerId = null;
    };

    // Capture phase, so a drag that crossed a tab never reaches its handler.
    const onClickCapture = (event: MouseEvent) => {
      if (!dragged) {
        return;
      }
      dragged = false;
      event.preventDefault();
      event.stopPropagation();
    };

    syncEdges();
    const observer = new ResizeObserver(syncEdges);
    observer.observe(container);
    container.addEventListener("scroll", syncEdges, { passive: true });
    container.addEventListener("pointerdown", onPointerDown);
    container.addEventListener("pointermove", onPointerMove);
    container.addEventListener("pointerup", endDrag);
    container.addEventListener("pointercancel", endDrag);
    container.addEventListener("click", onClickCapture, true);
    return () => {
      observer.disconnect();
      container.removeEventListener("scroll", syncEdges);
      container.removeEventListener("pointerdown", onPointerDown);
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("pointerup", endDrag);
      container.removeEventListener("pointercancel", endDrag);
      container.removeEventListener("click", onClickCapture, true);
    };
  }, [containerRef]);
}
