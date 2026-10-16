import { useEffect, useState } from "react";

import { authClient } from "@/features/auth/lib/auth-client";
import { getApiBaseUrl } from "@/lib/api-env";

import { fetchFollowingGustPreview } from "../lib/following-gust-preview";
import type { FollowingGustPreview } from "../lib/following-gust-preview";

const previewCache = new Map<
  string,
  { preview: FollowingGustPreview; fetchedAt: number }
>();

export function useFollowingGustPreview(
  userId: string | null,
  enabled: boolean
) {
  const apiBase = getApiBaseUrl();
  const key = `${apiBase}:${userId ?? "guest"}`;
  const [result, setResult] = useState<{
    preview: FollowingGustPreview;
    key: string;
  } | null>(() => {
    const cached = previewCache.get(key);
    return cached ? { key, preview: cached.preview } : null;
  });
  useEffect(() => {
    if (!userId || !enabled) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const cached = previewCache.get(key);
        const fresh = cached && Date.now() - cached.fetchedAt < 60_000;
        const preview = fresh
          ? cached.preview
          : await fetchFollowingGustPreview(userId, {
              apiBase,
              cookie: await authClient.getCookie(),
            });
        if (!cancelled) {
          if (!fresh) {
            previewCache.set(key, { fetchedAt: Date.now(), preview });
          }
          if (previewCache.size > 4) {
            const oldest = previewCache.keys().next().value;
            if (oldest) {
              previewCache.delete(oldest);
            }
          }
          setResult({ key, preview });
        }
      } catch {
        // The feed owns retry/error UI; an unavailable avatar preview stays empty.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, enabled, key, userId]);
  const preview = result?.key === key ? result.preview : undefined;
  return {
    data: preview?.data,
    fallbackAvatars: preview?.fallbackAvatars ?? [],
  };
}
