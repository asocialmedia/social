"use client";

import { useMemo, useSyncExternalStore } from "react";

import {
  FEED_EXPOSURE_EVENT,
  canonicalExposureFeed,
  feedExposureSnapshot,
} from "@/lib/posts/feed-exposure";
import type { FeedExposureSurface } from "@/lib/posts/feed-exposure";

function subscribe(listener: () => void) {
  window.addEventListener(FEED_EXPOSURE_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(FEED_EXPOSURE_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

export function useFeedExposures(
  viewer: string,
  surface: FeedExposureSurface,
  feed?: string
) {
  const snapshot = useSyncExternalStore(
    subscribe,
    () =>
      feedExposureSnapshot(
        viewer,
        surface,
        feed ? canonicalExposureFeed(feed) : undefined
      ),
    () => "[]"
  );
  return useMemo(() => new Set<string>(JSON.parse(snapshot)), [snapshot]);
}
