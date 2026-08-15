"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { useSession } from "@/app/(main)/session-provider";
import { fetchPresenceUsers, heartbeatPresence } from "@/lib/messages/client";
import type { PresenceUser } from "@/lib/messages/client";

const HEARTBEAT_MS = 30_000;
const POLL_MS = 30_000;

// The messages page mounts several components that all call usePresence(true)
// (conversation list, thread, rail). They share one query, so share one
// heartbeat too: the first consumer starts the interval, the last unmount
// clears it.
let heartbeatOwners = 0;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

function startHeartbeat(): () => void {
  heartbeatOwners += 1;
  if (heartbeatOwners === 1) {
    void heartbeatPresence();
    heartbeatInterval = setInterval(() => {
      void heartbeatPresence();
    }, HEARTBEAT_MS);
  }
  let stopped = false;
  return () => {
    if (stopped) {
      return;
    }
    stopped = true;
    heartbeatOwners -= 1;
    if (heartbeatOwners === 0 && heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
  };
}

export function usePresence(enabled = true): PresenceUser[] {
  const { user } = useSession();
  const queryClient = useQueryClient();
  // A stable id prevents unnecessary teardown, stream reconnects, and presence
  // refcount cycling when the user object identity changes.
  const userId = user?.id;

  useEffect(() => {
    if (!enabled || !userId) {
      return;
    }
    return startHeartbeat();
  }, [enabled, userId]);

  const { data } = useQuery({
    enabled: enabled && Boolean(user),
    queryFn: async () => {
      const users = await fetchPresenceUsers();
      return users;
    },
    queryKey: ["messages-presence", userId],
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: true,
  });

  useEffect(() => {
    if (!enabled || !userId) {
      return;
    }
    // Refresh the online rail whenever the tab regains focus.
    const onFocus = () => {
      void queryClient.invalidateQueries({
        queryKey: ["messages-presence", userId],
      });
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [enabled, queryClient, userId]);

  return data ?? [];
}
