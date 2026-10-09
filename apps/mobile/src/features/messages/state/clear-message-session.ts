// Clear only session memory on sign-out; SecureStore and server history survive.
import { messageDecryptor } from "../lib/decryptor";
import { forgetCachedPrivateKey } from "../lib/secure-key-store";
import { conversationListStore } from "./conversation-list-store";
import { transcriptStore } from "./transcript-store";

export function clearMessageSession(): void {
  messageDecryptor.configureScope("signed-out");
  forgetCachedPrivateKey();
  conversationListStore.reset();
  transcriptStore.clearAll();
}
