"use client";

import { useQueryClient } from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { useSession } from "@/lib/auth/session-context";

import { useNetworkSettings } from "./use-network-settings";

// Optional sidebars wait for primary feed data, with a fallback if that feed fails.
export function useSecondaryFeedReady() {
  const client = useQueryClient();
  const pathname = usePathname();
  const { user } = useSession();
  const network = useNetworkSettings();
  const viewer = user?.id ?? "guest";
  const scope = `${pathname}:${viewer}:${network.scope}`;
  const [releasedScope, setReleasedScope] = useState("");
  const subscribe = useCallback(
    (listener: () => void) => client.getQueryCache().subscribe(listener),
    [client]
  );
  const getSnapshot = useCallback(
    () =>
      client
        .getQueryCache()
        .getAll()
        .some(
          (query) =>
            [
              "post-feed",
              "bluesky-discovery",
              "explore-feed",
              "explore-gusts-grid",
              "gusts-feed",
            ].includes(String(query.queryKey[0])) &&
            query.queryKey.includes(viewer) &&
            query.queryKey.includes(network.scope) &&
            query.state.status === "success"
        ),
    [client, viewer, network.scope]
  );
  const ready = useSyncExternalStore(subscribe, getSnapshot, () => false);
  useEffect(() => {
    const timer = window.setTimeout(() => setReleasedScope(scope), 3000);
    return () => window.clearTimeout(timer);
  }, [scope]);
  return (
    !["/", "/discover", "/gusts"].includes(pathname) ||
    ready ||
    releasedScope === scope
  );
}
