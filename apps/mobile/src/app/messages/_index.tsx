import { useRouter } from "expo-router";
import { useCallback } from "react";

import { ConversationListScreen } from "@/features/messages/components/conversation-list-screen";
// Route wrapper: `/messages` is the conversation list, `/messages/[conversationId]`
// is one thread. Two screens rather than web's single pane-switching route, because
// a phone shows one pane at a time and the thread's back button is what swaps them
// -- the same rule `conversationListLayout` states on web, with the phone's actual
// navigation instead of a CSS breakpoint.
import { MessagesIdentityProvider } from "@/features/messages/state/message-identity";

export default function MessagesRoute() {
  return (
    <MessagesIdentityProvider>
      <ConversationList />
    </MessagesIdentityProvider>
  );
}

function ConversationList() {
  const router = useRouter();
  const open = useCallback(
    (conversationId: string) => {
      router.push(`/messages/${conversationId}`);
    },
    [router]
  );
  return <ConversationListScreen onOpen={open} />;
}
