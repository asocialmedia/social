import { fetch as streamingFetch } from "expo/fetch";
import { useEffect } from "react";
import { AppState } from "react-native";

import { authClient } from "@/features/auth/lib/auth-client";
import { useSessionContext } from "@/features/auth/state/session";
import {
  ackMessageDelivered,
  fetchConversationList,
  fetchUnreadMessageCount,
} from "@/features/messages/lib/client";
import { DeliveryAcknowledger } from "@/features/messages/lib/delivery-acknowledger";
import { readMessageActivityStream } from "@/features/messages/lib/realtime";
import { getApiBaseUrl } from "@/lib/api-env";
import { createExpoPoller } from "@/lib/expo-poller";

import { startPresenceHeartbeat } from "./conversation-list-store";
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
          const options = { apiBase, cookie };
          const delivery = new DeliveryAcknowledger(
            (conversationId, messageId) =>
              ackMessageDelivered(conversationId, messageId, options)
          );
          unreadMessageStore.configure(userId, async () => {
            const [count] = await Promise.all([
              fetchUnreadMessageCount(options),
              fetchConversationList(options)
                .then((list) => {
                  for (const row of list.items) {
                    const last = row.lastMessage;
                    if (!last || last.senderId === userId) {
                      continue;
                    }
                    const mine = row.conversation.members.find(
                      (member) => member.userId === userId
                    );
                    const deliveredAt = Date.parse(
                      mine?.lastDeliveredAt ?? mine?.lastReadAt ?? ""
                    );
                    if (deliveredAt >= Date.parse(last.createdAt)) {
                      continue;
                    }
                    void delivery.receive(row.conversation.id, last, userId);
                  }
                })
                .catch(() => {
                  // A failed list read must not discard an authoritative badge response.
                }),
            ]);
            return count;
          });
          const poller = createExpoPoller({
            intervalMs: 60_000,
            onPoll: unreadMessageStore.refresh,
          });
          poller.start();
          let controller: AbortController | null = null;
          let stopPresence: (() => void) | null = null;
          const reconcile = (state: string) => {
            controller?.abort();
            controller = null;
            stopPresence?.();
            stopPresence = null;
            if (state !== "active") {
              return;
            }
            stopPresence = startPresenceHeartbeat(options);
            controller = new AbortController();
            void readMessageActivityStream({
              baseFetch: streamingFetch,
              cookie,
              onActivity: unreadMessageStore.notifyActivity,
              onConnect: unreadMessageStore.notifyActivity,
              signal: controller.signal,
              url: `${apiBase}/api/messages/events`,
            });
          };
          const subscription = AppState.addEventListener("change", reconcile);
          reconcile(AppState.currentState);
          stop = () => {
            poller.stop();
            stopPresence?.();
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
