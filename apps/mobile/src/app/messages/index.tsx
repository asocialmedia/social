// Route wrapper: `/messages` is the conversation list, `/messages/[conversationId]`
// is one thread. Two screens rather than web's single pane-switching route, because
// a phone shows one pane at a time and the thread's back button is what swaps them
// -- the same rule `conversationListLayout` states on web, with the phone's actual
// navigation instead of a CSS breakpoint.
//
// The identity provider is NOT here. It sits in `messages/_layout.tsx` so it
// wraps both screens at once: bootstrapping a key runs PBKDF2 at 100k
// iterations, which is slow enough on Hermes that re-deriving it on every hop
// between the list and a thread showed up as a stall. The layout still renders
// above this screen, so a deep link into a thread resolves its key first.
import { useRouter } from "expo-router";
import { useCallback } from "react";

import { ConversationListScreen } from "@/features/messages/components/conversation-list-screen";

export default function MessagesRoute() {
  const router = useRouter();
  const open = useCallback(
    (conversationId: string) => {
      router.push(`/messages/${conversationId}`);
    },
    [router]
  );
  return <ConversationListScreen onOpen={open} />;
}
