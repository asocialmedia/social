// Clear only session memory on sign-out; SecureStore and server history survive.
import { messageDecryptor } from "../lib/decryptor";
import { forgetCachedPrivateKey } from "../lib/secure-key-store";
import { conversationListStore } from "./conversation-list-store";
import { clearMessageCacheSession } from "./message-cache";
import { transcriptStore } from "./transcript-store";
import { unreadMessageStore } from "./unread-message-store";

export function clearMessageSession(): void {
  clearMessageCacheSession();
  messageDecryptor.configureScope("signed-out");
  forgetCachedPrivateKey();
  conversationListStore.reset();
  unreadMessageStore.configure(null);
  transcriptStore.clearAll();
}
