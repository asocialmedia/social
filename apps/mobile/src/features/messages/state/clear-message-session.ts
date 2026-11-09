// Clear only session memory on sign-out; SecureStore and server history survive.
import { replayCursorStorage } from "../lib/change-replay-plan";
import { messageDecryptor } from "../lib/decryptor";
import { forgetCachedPrivateKey } from "../lib/secure-key-store";
import { senderRatchet } from "../lib/sender-ratchet";
import { conversationListStore } from "./conversation-list-store";
import { clearMessageCacheSession } from "./message-cache";
import { useSharedPostDraft } from "./shared-post-draft";
import { transcriptStore } from "./transcript-store";
import { unreadMessageStore } from "./unread-message-store";

export function clearMessageSession(): void {
  useSharedPostDraft.setState({ drafts: {} });
  clearMessageCacheSession();
  messageDecryptor.configureScope("signed-out");
  forgetCachedPrivateKey();
  senderRatchet.forget();
  replayCursorStorage.clear();
  conversationListStore.reset();
  unreadMessageStore.configure(null);
  transcriptStore.clearAll();
}
