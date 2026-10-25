import { readSnapshot, writeSnapshot } from "@/lib/cache/persistent-file";

import { hnCache } from "./hn-cache";
import type { HnPersistEntry } from "./hn-cache";

const CACHE_NAME = "hackernews-v1";
let hydration: Promise<void> | undefined;
let persistTimer: ReturnType<typeof setTimeout> | undefined;
let hydrationEpoch = 0;

export function hydrateHnCache(): Promise<void> {
  if (!hydration) {
    const epoch = hydrationEpoch;
    hydration = (async () => {
      const snapshot = await readSnapshot<HnPersistEntry>(CACHE_NAME);
      if (epoch === hydrationEpoch) {
        hnCache.hydrate(snapshot);
      }
    })();
  }
  return hydration;
}

export function clearHnCache(): void {
  hydrationEpoch += 1;
  hydration = Promise.resolve();
  hnCache.clear();
}

hnCache.subscribe(() => {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    void writeSnapshot(CACHE_NAME, hnCache.snapshot());
  }, 800);
});
