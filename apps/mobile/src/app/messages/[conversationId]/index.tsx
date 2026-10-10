// Route wrapper for one conversation.
//
// The identity provider lives in `messages/_layout.tsx`, above this screen, so a
// deep link straight into a thread (a push tap, a shared link) still resolves
// the key before the transcript tries to decrypt, while the list and the thread
// share one bootstrap rather than each paying for their own.
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback } from "react";

import { MessageThreadScreen } from "@/features/messages/components/message-thread-screen";

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
    router.replace("/messages");
  }, [router]);

  if (typeof conversationId !== "string" || conversationId.length === 0) {
    return null;
  }

  return <MessageThreadScreen conversationId={conversationId} onBack={back} />;
}
