import { queryOptions } from "@tanstack/react-query";

import type { LinkEmbed } from "@/lib/link-embeds/shared";

// Bound origin requests across the transcript and sidebar. Mounted sidebar rows
// arrive newest first; later rows wait rather than racing the first screen.
export function createPreviewQueue(concurrency: number) {
  let active = 0;
  const pending: (() => void)[] = [];
  function drain() {
    // oxlint-disable-next-line no-unmodified-loop-condition -- each start increments active synchronously
    while (active < concurrency && pending.length > 0) {
      pending.shift()?.();
    }
  }
  return function enqueue<T>(
    run: () => Promise<T>,
    signal: AbortSignal
  ): Promise<T> {
    const { promise, resolve, reject } = Promise.withResolvers<T>();
    {
      const cancel = () => {
        const index = pending.indexOf(start);
        if (index !== -1) {
          pending.splice(index, 1);
          reject(signal.reason);
        }
      };
      const start = () => {
        signal.removeEventListener("abort", cancel);
        if (signal.aborted) {
          reject(signal.reason);
          return;
        }
        active += 1;
        void (async () => {
          try {
            resolve(await run());
          } catch (error) {
            reject(error);
          } finally {
            active -= 1;
            drain();
          }
        })();
      };
      if (signal.aborted) {
        reject(signal.reason);
        return promise;
      }
      signal.addEventListener("abort", cancel, { once: true });
      pending.push(start);
      drain();
    }
    return promise;
  };
}

const enqueuePreview = createPreviewQueue(2);

export function fetchLinkPreview(url: string, signal: AbortSignal) {
  return enqueuePreview(async () => {
    const response = await fetch(
      `/api/link-preview?url=${encodeURIComponent(url)}`,
      { signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]) }
    );
    // Older deployments return 422 for unavailable metadata; cache it as a miss.
    if (response.status === 422) {
      return null;
    }
    if (!response.ok) {
      throw new Error("preview unavailable");
    }
    const json = (await response.json()) as { embed?: LinkEmbed | null };
    return json.embed ?? null;
  }, signal);
}

// All web preview surfaces share both successful and unavailable results.
export function linkPreviewQueryOptions(url: string) {
  return queryOptions({
    gcTime: 30 * 60 * 1000,
    queryFn: ({ signal }) => fetchLinkPreview(url, signal),
    queryKey: ["link-preview", url],
    retry: false,
    staleTime: (query) =>
      query.state.data === null ? 10 * 60 * 1000 : 30 * 60 * 1000,
  });
}
