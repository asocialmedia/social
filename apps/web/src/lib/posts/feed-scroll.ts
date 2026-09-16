// Anchor-based scroll memory for feed containers. Feeds live inside their own
// overflow containers (not window scroll), so the browser cannot restore them;
// and raw pixels alone would misplace you once media above the fold finishes
// loading at a different height. Saving the top-visible post plus its offset
// lets a restore re-anchor instead of trusting stale pixels.

// Post roots carry this attribute (PostCard, ExplorePostCard) so any feed
// container can locate them without knowing which card component rendered.
export const FEED_POST_ANCHOR_ATTRIBUTE = "data-post-id";

export interface TopAnchor {
  id: string;
  // Pixels from the container's visible top edge to the anchor's top edge.
  offset: number;
}

function escapeAttributeValue(value: string): string {
  try {
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
      return CSS.escape(value);
    }
  } catch {
    // Non-browser runtimes without CSS.escape fall through below.
  }
  return value.replaceAll(/["\\]/g, "\\$&");
}

// The first post that is at least partially visible from the top of the
// container, in DOM order. Partially-visible-at-top is the right anchor: it
// is the content the viewer was actually reading when the position saved.
export function findTopAnchor(container: HTMLElement): TopAnchor | null {
  const containerTop = container.getBoundingClientRect().top;
  const nodes = container.querySelectorAll(`[${FEED_POST_ANCHOR_ATTRIBUTE}]`);
  for (const node of nodes) {
    if (!(node instanceof HTMLElement)) {
      continue;
    }
    const id = node.getAttribute(FEED_POST_ANCHOR_ATTRIBUTE);
    if (!id) {
      continue;
    }
    const rect = node.getBoundingClientRect();
    if (rect.bottom > containerTop + 1) {
      return { id, offset: Math.max(0, rect.top - containerTop) };
    }
  }
  return null;
}

export function findAnchorElement(
  container: HTMLElement,
  postId: string
): HTMLElement | null {
  const node = container.querySelector(
    `[${FEED_POST_ANCHOR_ATTRIBUTE}="${escapeAttributeValue(postId)}"]`
  );
  return node instanceof HTMLElement ? node : null;
}

// Scroll offset that puts the anchor back where it sat at save time,
// compensating for any height drift above it (loaded media, new content).
export function computeAnchorScrollTop(
  container: HTMLElement,
  anchor: HTMLElement,
  savedOffset: number
): number {
  const containerTop = container.getBoundingClientRect().top;
  const anchorTop = anchor.getBoundingClientRect().top;
  return container.scrollTop + (anchorTop - containerTop) - savedOffset;
}

export function clampScrollTop(container: HTMLElement, value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const max = Math.max(0, container.scrollHeight - container.clientHeight);
  return Math.min(Math.max(0, value), max);
}
