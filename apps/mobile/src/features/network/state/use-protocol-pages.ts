// oxlint-disable react/refs, react/set-state-in-effect, react/exhaustive-effect-dependencies -- External cursor requests use refs for cancellation; key changes clear request-only status.
import { useEffect, useRef, useState } from "react";

import { useProtocolResource } from "./use-protocol-resource";

export interface ProtocolPage<T, Cursor> {
  items: T[];
  cursor: Cursor | null;
}
export function useProtocolPages<T, Cursor>(
  key: string,
  read: (
    cursor: Cursor | null,
    signal: AbortSignal
  ) => Promise<ProtocolPage<T, Cursor>>,
  enabled = true
) {
  const first = useProtocolResource(
    key,
    (signal) => read(null, signal),
    enabled
  );
  const [extra, setExtra] = useState<{
    key: string;
    pages: ProtocolPage<T, Cursor>[];
    first?: ProtocolPage<T, Cursor>;
  }>({ key, pages: [] });
  const [moreError, setMoreError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const active = useRef(key);
  active.current = key;
  const pending = useRef<AbortController | null>(null);
  const pages = [
    ...(first.data ? [first.data] : []),
    ...(extra.key === key && extra.first === first.data ? extra.pages : []),
  ];
  const cursor = pages.at(-1)?.cursor ?? null;
  useEffect(() => {
    setMoreError(null);
    setLoadingMore(false);
    return () => {
      pending.current?.abort();
      pending.current = null;
    };
  }, [key]);
  const fetchNext = async () => {
    if (!enabled || !cursor || pending.current) {
      return;
    }
    const controller = new AbortController();
    pending.current = controller;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = await read(cursor, controller.signal);
      if (!controller.signal.aborted && active.current === key) {
        setExtra((current) => ({
          first: first.data,
          key,
          pages: [
            ...(current.key === key && current.first === first.data
              ? current.pages
              : []),
            page,
          ],
        }));
      }
    } catch (error) {
      if (!controller.signal.aborted && active.current === key) {
        setMoreError(
          error instanceof Error ? error.message : "Couldn't load more"
        );
      }
    }
    if (pending.current === controller) {
      pending.current = null;
      setLoadingMore(false);
    }
  };
  return {
    ...first,
    error: moreError ?? first.error,
    fetchNext,
    hasMore: Boolean(cursor),
    items: pages.flatMap((page) => page.items),
    loadingMore,
    refresh: async () => {
      pending.current?.abort();
      pending.current = null;
      setExtra({ key, pages: [] });
      setMoreError(null);
      await first.refetch();
    },
  };
}
