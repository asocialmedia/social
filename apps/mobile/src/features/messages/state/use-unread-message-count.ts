import { useSyncExternalStore } from "react";

import { useSessionContext } from "@/features/auth/state/session";

import { unreadMessageStore } from "./unread-message-store";

// Keep dock startup independent of the transcript, identity and crypto modules.
export function useUnreadMessageCount(): number {
  const { user } = useSessionContext();
  const count = useSyncExternalStore(
    unreadMessageStore.subscribe,
    unreadMessageStore.getSnapshot,
    unreadMessageStore.getSnapshot
  );
  return user?.id === unreadMessageStore.getScope() ? count : 0;
}
