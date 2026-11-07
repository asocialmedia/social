// Route wrapper: `/messages` is the conversation list, `/messages/[conversationId]`
// is one thread. Two screens rather than web's single pane-switching route, because
// a phone shows one pane at a time and the thread's back button is what swaps them
// -- the same rule `conversationListLayout` states on web, with the phone's actual
// navigation instead of a CSS breakpoint.
//
// The identity provider is NOT here. It sits in `messages/_layout.tsx` so it
// wraps both screens at once: background key recovery is shared between the
// list and a thread. The layout still renders
// above this screen, so a deep link into a thread resolves its key first.
//
// `?dm=<userId>` is web's profile deep link: the list creates or finds that DM
// once the identity is ready, and the param is cleared so a back navigation to
// the list does not open it again.
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback } from "react";

import { ConversationListScreen } from "@/features/messages/components/conversation-list-screen";

export default function MessagesRoute() {
  const router = useRouter();
  const { dm } = useLocalSearchParams<{ dm?: string | string[] }>();
  const dmUserId = Array.isArray(dm) ? dm[0] : dm;
  const open = useCallback(
    (conversationId: string) => {
      router.push(`/messages/${conversationId}`);
    },
    [router]
  );
  const openMessage = useCallback(
    (conversationId: string, messageId: string) => {
      router.push({
        params: { conversationId, mid: messageId },
        pathname: "/messages/[conversationId]",
      });
    },
    [router]
  );
  const clearDm = useCallback(() => {
    router.setParams({ dm: undefined });
  }, [router]);
  return (
    <ConversationListScreen
      dmUserId={dmUserId ?? null}
      onDmHandled={clearDm}
      onOpen={open}
      onOpenMessage={openMessage}
    />
  );
}
