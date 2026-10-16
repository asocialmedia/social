import { useCallback, useEffect, useSyncExternalStore } from "react";

import type { ResourceCache } from "./resource-cache";

export function useCachedResource<T>(
  cache: ResourceCache<T>,
  key: string | null,
  loader: () => Promise<T>
) {
  const snapshot = useCallback(() => cache.read(key ?? ""), [cache, key]);
  const resource = useSyncExternalStore(cache.subscribe, snapshot, snapshot);
  useEffect(() => {
    if (key) {
      void cache.load(key, loader);
    }
  }, [cache, key, loader]);
  const reload = useCallback(
    () => (key ? cache.load(key, loader, true) : Promise.resolve()),
    [cache, key, loader]
  );
  return { ...resource, reload };
}
