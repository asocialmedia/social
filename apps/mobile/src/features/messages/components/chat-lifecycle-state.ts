import { throwChatError } from "@asm/messages";
import type { ChatLifecycleSnapshot } from "@asm/messages";
import { createContext, useContext } from "react";

import type { ApiCallOptions } from "@/features/feed/lib/feed-api";

interface NativeLifecycleContext {
  snapshot: ChatLifecycleSnapshot | null;
  error: string | null;
  busy: boolean;
  revision: number;
  contentRevision: number;
  fresh: boolean;
  serverOffset: number;
  options: ApiCallOptions | null;
  refresh: () => void;
  mutate: (body: object) => Promise<boolean>;
  loadEarlierNotices: () => Promise<void>;
  requestIncognito: () => void;
}
export const ChatLifecycleContext =
  createContext<NativeLifecycleContext | null>(null);
export function useNativeChatLifecycle() {
  const value = useContext(ChatLifecycleContext);
  if (!value) {
    throwChatError(new Error("Chat lifecycle provider required"));
  }
  return value;
}
