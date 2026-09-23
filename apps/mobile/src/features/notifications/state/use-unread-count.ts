// React binding for the unread-count store. The store owns the value and the
// poll loop; this hook subscribes and returns the current count. `enabled`
// starts/stops polling for the active identity (a user id, or null for a
// guest), so signing in starts the loop and signing out stops it.
import { useEffect, useState } from "react";

import { unreadCountStore } from "./unread-store";

export function useUnreadNotificationCount(
  identity: string | null | undefined,
  enabled: boolean
): number {
  const [count, setCount] = useState(() => unreadCountStore.get());

  useEffect(() => {
    if (!enabled) {
      unreadCountStore.stop();
      return;
    }
    unreadCountStore.start(identity ?? "guest");
    return unreadCountStore.subscribe(setCount);
  }, [enabled, identity]);

  return count;
}
