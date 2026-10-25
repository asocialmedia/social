"use client";

import { useEffect, useRef } from "react";

// Recover a failed continuation without replacing the reader's loaded pages.
export function useFeedRecovery({
  enabled,
  failed,
  fetching,
  updatedAt,
  resetKey,
  retry,
}: {
  enabled: boolean;
  failed: boolean;
  fetching: boolean;
  updatedAt: number;
  resetKey: string;
  retry: () => Promise<unknown>;
}) {
  const latest = useRef(retry);
  const attempts = useRef({ count: 0, key: resetKey, updatedAt });
  useEffect(() => {
    latest.current = retry;
  }, [retry]);
  useEffect(() => {
    if (
      attempts.current.key !== resetKey ||
      attempts.current.updatedAt !== updatedAt
    ) {
      attempts.current = { count: 0, key: resetKey, updatedAt };
    }
    if (!enabled || !failed || fetching || attempts.current.count >= 3) {
      return;
    }
    let timer: number | undefined;
    const schedule = () => {
      window.clearTimeout(timer);
      if (
        document.visibilityState === "hidden" ||
        attempts.current.count >= 3
      ) {
        return;
      }
      timer = window.setTimeout(
        async () => {
          attempts.current.count += 1;
          try {
            await latest.current();
          } catch {
            // Keep the existing pages and leave the explicit retry available.
          }
        },
        2000 * 2 ** attempts.current.count
      );
    };
    schedule();
    document.addEventListener("visibilitychange", schedule);
    window.addEventListener("online", schedule);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", schedule);
      window.removeEventListener("online", schedule);
    };
  }, [enabled, failed, fetching, updatedAt, resetKey]);
}
