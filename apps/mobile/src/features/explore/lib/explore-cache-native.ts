import { readSnapshot, writeSnapshot } from "@/lib/persistent-file";

import { exploreCache } from "./explore-cache";
import type { ExploreData } from "./explore-cache";

const CACHE_NAME = "explore-v1";
let hydration: Promise<void> | undefined;
let persistTimer: ReturnType<typeof setTimeout> | undefined;
let hydrationEpoch = 0;

export function hydrateExploreCache(): Promise<void> {
  if (!hydration) {
    const epoch = hydrationEpoch;
    hydration = (async () => {
      const snapshot = await readSnapshot<ExploreData>(CACHE_NAME);
      if (epoch === hydrationEpoch) {
        exploreCache.hydrate(snapshot);
      }
    })();
  }
  return hydration;
}

export function clearExploreCache(): void {
  hydrationEpoch += 1;
  hydration = Promise.resolve();
  exploreCache.clear();
}

exploreCache.subscribe(() => {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    void writeSnapshot(CACHE_NAME, exploreCache.snapshot());
  }, 500);
});
