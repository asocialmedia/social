"use client";

import { feedHeadFreshMs } from "@asm/protocols/discovery";
import { useQueryClient } from "@tanstack/react-query";
import type { QueryKey } from "@tanstack/react-query";
import { useEffect } from "react";

export function useExpiredFeedHead(queryKey: QueryKey, enabled: boolean) {
  const client = useQueryClient();
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const refresh = () => {
      const state = client.getQueryState(queryKey);
      if (
        document.visibilityState === "visible" &&
        state?.fetchStatus === "idle" &&
        state.dataUpdatedAt > 0 &&
        Date.now() - state.dataUpdatedAt >= feedHeadFreshMs
      ) {
        void client.resetQueries({ exact: true, queryKey });
      }
    };
    refresh();
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, [client, enabled, queryKey]);
}
