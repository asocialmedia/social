import { fetch as streamingFetch } from "expo/fetch";
import { useEffect } from "react";
import { AppState } from "react-native";

import { authClient } from "@/features/auth/lib/auth-client";
import { useSessionContext } from "@/features/auth/state/session";
import { fetchUnreadMessageCount } from "@/features/messages/lib/client";
import { readMessageActivityStream } from "@/features/messages/lib/realtime";
import { getApiBaseUrl } from "@/lib/api-env";
import { createExpoPoller } from "@/lib/expo-poller";

import { unreadMessageStore } from "./unread-message-store";

// Mounted once above navigation, so every screen shares one stream and poller.
export function UnreadMessageObserver() {
  const { user } = useSessionContext();
  const userId = user?.id ?? null;
  useEffect(() => {
    let cancelled = false;
    let stop = () => {
      // Cleanup is installed once the credential is ready.
    };
    unreadMessageStore.configure(userId);
    if (userId) {
      void (async () => {
        try {
          const cookie = await authClient.getCookie();
          if (cancelled || !cookie) {
            return;
          }
          const apiBase = getApiBaseUrl();
          unreadMessageStore.configure(userId, () =>
            fetchUnreadMessageCount({ apiBase, cookie })
          );
          const poller = createExpoPoller({
            intervalMs: 60_000,
            onPoll: unreadMessageStore.refresh,
          });
          poller.start();
          let controller: AbortController | null = null;
          const reconcile = (state: string) => {
            controller?.abort();
            controller = null;
            if (state !== "active") {
              return;
            }
            controller = new AbortController();
            void readMessageActivityStream({
              baseFetch: streamingFetch,
              cookie,
              onActivity: unreadMessageStore.notifyActivity,
              signal: controller.signal,
              url: `${apiBase}/api/messages/events`,
            });
          };
          const subscription = AppState.addEventListener("change", reconcile);
          reconcile(AppState.currentState);
          stop = () => {
            poller.stop();
            controller?.abort();
            subscription.remove();
          };
        } catch {
          // A failed credential read must not prevent navigation.
        }
      })();
    }
    return () => {
      cancelled = true;
      stop();
      unreadMessageStore.configure(userId);
    };
  }, [userId]);
  return null;
}
