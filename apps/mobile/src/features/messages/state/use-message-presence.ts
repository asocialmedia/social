import { useEffect, useSyncExternalStore } from "react";

import { authClient } from "@/features/auth/lib/auth-client";
import { useSessionContext } from "@/features/auth/state/session";
import { fetchPresenceUsers } from "@/features/messages/lib/client";
import type { PresenceUser } from "@/features/messages/lib/client";
import { getApiBaseUrl } from "@/lib/api-env";

import { useMessagesForeground } from "./use-messages-foreground";

const EMPTY: PresenceUser[] = [];
let snapshot = { scope: "", users: EMPTY };
const listeners = new Set<() => void>();
let owners = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let generation = 0;
let pending = false;
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const getSnapshot = () => snapshot;

// Covered screens share cached dots, but only the foreground screen polls.
export function useMessagePresence(): PresenceUser[] {
  const { user } = useSessionContext();
  const scope = user?.id ?? "";
  const foreground = useMessagesForeground();
  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  useEffect(
    () => (scope && foreground ? acquirePresence(scope) : undefined),
    [foreground, scope]
  );
  return current.scope === scope ? current.users : EMPTY;
}

function acquirePresence(scope: string) {
  let cancelled = false;
  let acquired = false;
  void (async () => {
    const cookie = await authClient.getCookie().catch(() => {
      /* empty */
    });
    if (cancelled || !cookie) {
      return;
    }
    acquired = true;
    owners += 1;
    if (snapshot.scope !== scope) {
      generation += 1;
      pending = false;
      snapshot = { scope, users: EMPTY };
      for (const listener of listeners) {
        listener();
      }
    }
    if (timer) {
      return;
    }
    generation += 1;
    const activeGeneration = generation;
    const refresh = async () => {
      if (pending) {
        return;
      }
      pending = true;
      try {
        const users = await fetchPresenceUsers({
          apiBase: getApiBaseUrl(),
          cookie,
        });
        if (generation === activeGeneration) {
          snapshot = { scope, users };
          for (const listener of listeners) {
            listener();
          }
        }
      } catch {
        // Keep the last known dots during a brief network interruption.
      }
      if (generation === activeGeneration) {
        pending = false;
      }
    };
    void refresh();
    timer = setInterval(() => {
      void refresh();
    }, 15_000);
  })();
  return () => {
    cancelled = true;
    if (!acquired) {
      return;
    }
    owners -= 1;
    if (owners === 0) {
      generation += 1;
      pending = false;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    }
  };
}
