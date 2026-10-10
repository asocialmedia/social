import { useEffect, useState } from "react";

import { authClient } from "@/features/auth/lib/auth-client";
import type { PostsPage } from "@/features/feed/lib/feed-types";
import { getApiBaseUrl } from "@/lib/api-env";

import { fetchGustsPage } from "../lib/gusts-api";

const previewCache = new Map<string, { data: PostsPage; fetchedAt: number }>();

export function useFollowingGustPreview(
  userId: string | null,
  enabled: boolean
) {
  const apiBase = getApiBaseUrl();
  const key = `${apiBase}:${userId ?? "guest"}`;
  const [result, setResult] = useState<{ data: PostsPage; key: string } | null>(
    null
  );
  useEffect(() => {
    if (!userId || !enabled) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const cached = previewCache.get(key);
        const data =
          cached && Date.now() - cached.fetchedAt < 60_000
            ? cached.data
            : await fetchGustsPage(
                { following: true, personalized: false, take: 5 },
                { apiBase, cookie: await authClient.getCookie() }
              );
        if (!cancelled) {
          previewCache.set(key, { data, fetchedAt: Date.now() });
          if (previewCache.size > 4) {
            const oldest = previewCache.keys().next().value;
            if (oldest) {
              previewCache.delete(oldest);
            }
          }
          setResult({ data, key });
        }
      } catch {
        // The feed owns retry/error UI; an unavailable avatar preview stays empty.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, enabled, key, userId]);
  return { data: result?.key === key ? result.data : undefined };
}
