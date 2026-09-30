// Route wrapper for one conversation. The identity provider lives on the list
// route and is re-established here, so a deep link straight into a thread (a push
// tap, a shared link) resolves the key before the transcript tries to decrypt.
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback } from "react";

import { MessageThreadScreen } from "@/features/messages/components/message-thread-screen";
import { MessagesIdentityProvider } from "@/features/messages/state/message-identity";

export default function ConversationRoute() {
  const { conversationId } = useLocalSearchParams<{ conversationId: string }>();
  const router = useRouter();
  const back = useCallback(() => {
    // A thread opened from a push notification has no list behind it to go back to,
    // so a hardware/gesture back must not pop past the app root.
    if (router.canGoBack()) {
      router.back();
      return;
    }
    // The index of a folder route is addressed as /messages/_index by the typed
    // router, not /messages.
    router.replace("/messages/_index");
  }, [router]);

  if (typeof conversationId !== "string" || conversationId.length === 0) {
    return null;
  }

  return (
    <MessagesIdentityProvider>
      <MessageThreadScreen conversationId={conversationId} onBack={back} />
    </MessagesIdentityProvider>
  );
}
