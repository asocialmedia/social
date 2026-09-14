"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Any feed item the hook can key on. PostData satisfies this.
export interface NewContentItem {
  id: string;
}

// Walks the freshly-fetched head page until it meets an item the viewer already
// has. The page is newest-first, so everything before the first known id is new.
// Pure and exported so the ordering contract is unit-testable.
export function findUnseenItems<T extends NewContentItem>(
  fresh: T[],
  knownIds: ReadonlySet<string>
): T[] {
  const unseen: T[] = [];
  for (const item of fresh) {
    if (knownIds.has(item.id)) {
      break;
    }
    unseen.push(item);
  }
  return unseen;
}

interface UseNewContentProbeOptions<T extends NewContentItem> {
  // Skip probing entirely (e.g. a deep-linked detail feed that is not the
  // active timeline).
  enabled?: boolean;
  // Fetches ONLY the first page. Keeping this separate from the feed's
  // useInfiniteQuery is what lets a cached list stay on screen untouched.
  fetchHead: () => Promise<T[]>;
  // Drops items that should never be surfaced as new (gusts only render video).
  filter?: (item: T) => boolean;
  intervalMs?: number;
  // Clears the badge when the feed identity changes (tab switch, deep link).
  resetKey?: string | number;
  // The posts currently rendered. Changes to this array keep the baseline
  // aligned with what the viewer can actually see.
  visible: T[];
}

interface UseNewContentProbeResult<T> {
  clearNewItems: () => void;
  newItems: T[];
}

// Twitter-style new-content detection: probe the head in the background, then
// hold the unseen posts in local state so the visible feed and its scroll
// position never move until the viewer taps the badge. The caller decides how
// to merge (prepend) and scroll on tap.
export function useNewContentProbe<T extends NewContentItem>({
  enabled = true,
  fetchHead,
  filter,
  intervalMs = 45_000,
  resetKey,
  visible,
}: UseNewContentProbeOptions<T>): UseNewContentProbeResult<T> {
  // The badge carries the reset key it belongs to, so switching feeds hides the
  // stale badge during render instead of through a state-clearing effect.
  const [badge, setBadge] = useState<{
    items: T[];
    key: UseNewContentProbeOptions<T>["resetKey"];
  }>({ items: [], key: resetKey });
  const newItems = badge.key === resetKey ? badge.items : [];

  // Latest values live in refs so the polling interval keeps one stable
  // identity and is not torn down/recreated on every render.
  const visibleRef = useRef(visible);
  const fetchHeadRef = useRef(fetchHead);
  const filterRef = useRef(filter);

  useEffect(() => {
    visibleRef.current = visible;
  }, [visible]);

  useEffect(() => {
    fetchHeadRef.current = fetchHead;
    filterRef.current = filter;
  }, [fetchHead, filter]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const probe = async () => {
      const { current } = visibleRef;
      if (current.length === 0) {
        return;
      }
      let fresh: T[];
      try {
        fresh = await fetchHeadRef.current();
      } catch {
        // Best-effort probe; keep the current feed on transient failures.
        return;
      }
      const { current: filterFn } = filterRef;
      const candidates = filterFn ? fresh.filter(filterFn) : fresh;
      const freshHead = candidates[0]?.id;
      // Same head means nothing new arrived above what is already rendered,
      // even if the server reshuffled the body of the page.
      if (!freshHead || freshHead === current[0]?.id) {
        return;
      }
      const unseen = findUnseenItems(
        candidates,
        new Set(current.map((item) => item.id))
      );
      if (unseen.length > 0) {
        setBadge({ items: unseen, key: resetKey });
      }
    };

    // Probe immediately so returning to a cached tab surfaces an existing
    // backlog right away instead of waiting a full interval.
    void probe();
    const interval = window.setInterval(() => {
      void probe();
    }, intervalMs);
    return () => window.clearInterval(interval);
  }, [enabled, intervalMs, resetKey]);

  const clearNewItems = useCallback(() => {
    setBadge((previous) => ({ ...previous, items: [] }));
  }, []);

  return { clearNewItems, newItems };
}
