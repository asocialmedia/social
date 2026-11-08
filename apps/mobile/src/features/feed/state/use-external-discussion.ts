// Comment pages for a Bluesky post's asocialmedia discussion, for surfaces
// that do not already load the post detail (the gust eddies sheet). Mirrors
// web ExternalDiscussion's infinite query: head page, cursor pages deduped
// by id, refetch after a mutation, and a retry on failure.
import type { ExternalComment } from "@asm/protocols/discovery";
import { useCallback, useEffect, useRef, useState } from "react";

import { mergeExternalComments } from "../lib/external-comments";
import { readExternal } from "../lib/external-interactions";

type Cursor = { createdAt: string; id: string } | null;

export function useExternalDiscussion(uri: string) {
  const [comments, setComments] = useState<ExternalComment[]>([]);
  const [cursor, setCursor] = useState<Cursor>(null);
  const [status, setStatus] = useState<"error" | "loading" | "ready">(
    "loading"
  );
  const [loadingMore, setLoadingMore] = useState(false);
  const generation = useRef(0);

  const reload = useCallback(
    async (signal?: AbortSignal) => {
      generation.current += 1;
      const { current } = generation;
      try {
        const page = await readExternal(uri, undefined, signal);
        if (signal?.aborted || current !== generation.current) {
          return;
        }
        setComments(page.comments.items);
        setCursor(page.comments.cursor ?? null);
        setStatus("ready");
      } catch {
        if (!signal?.aborted && current === generation.current) {
          setStatus((previous) => (previous === "ready" ? previous : "error"));
        }
      }
    },
    [uri]
  );

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        void reload(controller.signal);
      }
    });
    return () => controller.abort();
  }, [reload]);

  const loadMore = async () => {
    if (!cursor || loadingMore) {
      return;
    }
    setLoadingMore(true);
    const { current } = generation;
    try {
      const page = await readExternal(uri, cursor);
      if (current === generation.current) {
        setComments((existing) =>
          mergeExternalComments(existing, page.comments.items)
        );
        setCursor(page.comments.cursor ?? null);
      }
    } catch {
      // The link stays, so the reader can try the page again.
    }
    setLoadingMore(false);
  };

  const retry = () => {
    setStatus("loading");
    void reload();
  };

  return {
    comments,
    hasMore: cursor !== null,
    loadMore,
    loadingMore,
    reload: () => reload(),
    retry,
    status,
  };
}
