// oxlint-disable react/refs, react/exhaustive-effect-dependencies, promise/prefer-await-to-then, promise/prefer-await-to-callbacks -- The keyed external store keeps the latest loader in a ref; its shared promise owns request deduplication.
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

interface ResourceState {
  data?: unknown;
  error: string | null;
  loading: boolean;
  updatedAt: number;
  revision: number;
}
const EMPTY: ResourceState = {
  error: null,
  loading: false,
  revision: 0,
  updatedAt: 0,
};
const entries = new Map<string, ResourceState>();
const listeners = new Map<string, Set<() => void>>();
const requests = new Map<string, Promise<void>>();
function update(key: string, patch: Partial<ResourceState>) {
  entries.set(key, { ...(entries.get(key) ?? EMPTY), ...patch });
  if (entries.size > 500) {
    for (const candidate of entries.keys()) {
      if (!listeners.get(candidate)?.size && !requests.has(candidate)) {
        entries.delete(candidate);
        break;
      }
    }
  }
  for (const listener of listeners.get(key) ?? []) {
    listener();
  }
}
export function seedProtocolResource(key: string, data: unknown) {
  if (!entries.get(key)?.data) {
    update(key, { data });
  }
}
export function invalidateProtocolResources(prefix: string) {
  for (const [key, value] of entries) {
    if (key.startsWith(prefix)) {
      update(key, { revision: value.revision + 1, updatedAt: 0 });
    }
  }
}
export function useProtocolResource<T>(
  key: string,
  read: (signal: AbortSignal) => Promise<T>,
  enabled = true,
  staleMs = 30_000
) {
  const loader = useRef(read);
  loader.current = read;
  const subscribe = useCallback(
    (listener: () => void) => {
      const current = listeners.get(key) ?? new Set<() => void>();
      current.add(listener);
      listeners.set(key, current);
      return () => {
        current.delete(listener);
        if (!current.size) {
          listeners.delete(key);
        }
      };
    },
    [key]
  );
  const snapshot = useCallback(() => entries.get(key) ?? EMPTY, [key]);
  const state = useSyncExternalStore(subscribe, snapshot, snapshot);
  const refetch = useCallback(
    (force = true) => {
      if (!enabled) {
        return Promise.resolve();
      }
      const pending = requests.get(key);
      if (pending) {
        return pending;
      }
      const current = entries.get(key);
      if (
        !force &&
        current?.data !== undefined &&
        Date.now() - current.updatedAt < staleMs
      ) {
        return Promise.resolve();
      }
      update(key, { error: null, loading: true });
      const readResource = loader.current;
      const request = Promise.resolve()
        .then(() => readResource(AbortSignal.timeout(20_000)))
        .then((data) => update(key, { data, updatedAt: Date.now() }))
        .catch((error: unknown) =>
          update(key, {
            error:
              error instanceof Error
                ? error.message
                : "Couldn't load. Please retry.",
          })
        )
        .finally(() => {
          requests.delete(key);
          update(key, { loading: false });
        });
      requests.set(key, request);
      return request;
    },
    [enabled, key, staleMs]
  );
  useEffect(() => {
    void refetch(false);
  }, [refetch, state.revision]);
  return {
    data: state.data as T | undefined,
    error: state.error,
    loading:
      state.loading || (enabled && state.data === undefined && !state.error),
    refetch,
  };
}
