import { useCallback, useEffect, useRef } from "react";

import { createConversationReconciliationController } from "./conversation-reconciliation";
import type { ConversationReconciliationController } from "./conversation-reconciliation";

export function useConversationReconciliation(input: {
  conversationId: string;
  enabled: boolean;
  reconcile: (signal: AbortSignal) => Promise<boolean>;
  userId: string | undefined;
}): () => Promise<boolean> {
  const { conversationId, enabled, reconcile, userId } = input;
  const controllerRef = useRef<ConversationReconciliationController | null>(
    null
  );

  useEffect(() => {
    if (!enabled || !userId || !conversationId) {
      return;
    }
    const controller = createConversationReconciliationController({
      available: () =>
        document.visibilityState === "visible" && navigator.onLine,
      reconcile,
    });
    controllerRef.current = controller;
    void controller.request();
    const reconcileWhenAvailable = () => {
      void controller.request();
    };
    window.addEventListener("online", reconcileWhenAvailable);
    window.addEventListener("focus", reconcileWhenAvailable);
    document.addEventListener("visibilitychange", reconcileWhenAvailable);
    return () => {
      controller.dispose();
      window.removeEventListener("online", reconcileWhenAvailable);
      window.removeEventListener("focus", reconcileWhenAvailable);
      document.removeEventListener("visibilitychange", reconcileWhenAvailable);
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
    };
  }, [conversationId, enabled, reconcile, userId]);

  return useCallback(
    () => controllerRef.current?.request() ?? Promise.resolve(false),
    []
  );
}
