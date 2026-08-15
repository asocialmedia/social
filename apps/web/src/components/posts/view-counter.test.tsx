import { describe, expect, test } from "bun:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";

import ViewTracker from "./view-counter";

// View tracking is driven by an IntersectionObserver watching an invisible
// marker inside each post card. For the observer to fire, the marker must stay
// geometrically visible: `sr-only` (used before) clips the element down to zero
// area via clip-path, so `entry.isIntersecting` is always false and views are
// never recorded. The marker must therefore use an unclipped class.
function renderTracker(): string {
  const queryClient = new QueryClient();
  const app = renderToString(
    <QueryClientProvider client={queryClient}>
      <ViewTracker postId="post1" />
    </QueryClientProvider>
  );
  return app;
}

describe("ViewTracker", () => {
  test("renders an unclipped invisible marker, not sr-only", () => {
    const html = renderTracker();
    expect(html).toContain("aria-hidden");
    expect(html).not.toContain("sr-only");
    expect(html).not.toContain("clip");
    // The marker must keep a real (unclipped) 1px footprint so the
    // IntersectionObserver can report it intersecting; `sr-only` collapses it
    // to zero area via clip-path, which would break view tracking.
    expect(html).toContain("h-px");
    expect(html).toContain("w-px");
    expect(html).toContain("block");
    expect(html).toContain("opacity-0");
    expect(html).toContain("pointer-events-none");
  });
});
