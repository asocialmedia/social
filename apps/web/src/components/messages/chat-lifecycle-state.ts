"use client";

import { throwChatError } from "@asm/messages";
import type { ChatLifecycleSnapshot } from "@asm/messages";
import { createContext, useContext } from "react";

interface LifecycleContext {
  snapshot: ChatLifecycleSnapshot | undefined;
  error: string | null;
  busy: boolean;
  connected: boolean;
  revision: number;
  fresh: boolean;
  refresh: () => void;
  loadEarlierNotices: () => Promise<void>;
  mutate: (body: object) => Promise<boolean>;
  dismiss: () => void;
  requestIncognito: () => void;
}
export const ChatLifecycleContext = createContext<LifecycleContext | null>(
  null
);
export function useChatLifecycle() {
  const context = useContext(ChatLifecycleContext);
  if (!context) {
    throwChatError(new Error("Chat lifecycle provider required"));
  }
  return context;
}
