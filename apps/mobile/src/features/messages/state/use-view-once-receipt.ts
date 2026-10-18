// oxlint-disable promise/avoid-new -- Retry delays use the platform timer API.
// oxlint-disable no-await-in-loop -- Receipt retries are sequential and use bounded exponential backoff.
import {
  isViewOnceUnavailable,
  retryViewOnceReceipt,
  viewOnceReceiptKey,
} from "@asm/messages";
import type { ViewOnceReceipt } from "@asm/messages";
import { useCallback, useEffect, useState } from "react";

import { authClient } from "@/features/auth/lib/auth-client";
import { useSessionContext } from "@/features/auth/state/session";
import {
  acknowledgeViewOnceSeen,
  fetchViewOnceReceipt,
} from "@/features/messages/lib/view-once-client";
import { getApiBaseUrl } from "@/lib/api-env";

import { useMessagesForeground } from "./use-messages-foreground";

type ReceiptListener = (receipt?: ViewOnceReceipt) => void;
const observers = new Map<string, Set<ReceiptListener>>();

function scopeFor(userId: string, conversationId: string, mediaId: string) {
  return JSON.stringify(viewOnceReceiptKey(userId, conversationId, mediaId));
}

function notify(scope: string, receipt?: ViewOnceReceipt) {
  for (const listener of observers.get(scope) ?? []) {
    listener(receipt);
  }
}

export function invalidateViewOnceReceipt(
  userId: string,
  conversationId: string,
  mediaId: string
) {
  notify(scopeFor(userId, conversationId, mediaId));
}

async function apiOptions() {
  return {
    apiBase: getApiBaseUrl(),
    cookie: (await authClient.getCookie()) ?? undefined,
  };
}

async function confirmReceipt(
  conversationId: string,
  mediaId: string,
  grantId: string,
  scope: string
) {
  for (let attempt = 0; attempt <= 5; attempt += 1) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- Each retry waits for the previous request to fail.
      const receipt = await acknowledgeViewOnceSeen(
        conversationId,
        mediaId,
        grantId,
        await apiOptions()
      );
      notify(scope, receipt);
      return;
    } catch (error) {
      if (!retryViewOnceReceipt(attempt, error)) {
        return;
      }
      // oxlint-disable-next-line no-await-in-loop -- Back off without blocking the native UI thread.
      await new Promise<void>((resolve) => {
        setTimeout(resolve, Math.min(1000 * 2 ** attempt, 10_000));
      });
    }
  }
}

export function useViewOnceReceipt(
  conversationId: string | undefined,
  mediaId: string
) {
  const { user } = useSessionContext();
  const foreground = useMessagesForeground();
  const userId = user?.id ?? "";
  const scope = scopeFor(userId, conversationId ?? "", mediaId);
  const [state, setState] = useState<{
    scope: string;
    data?: ViewOnceReceipt;
    error?: unknown;
  }>({ scope });
  useEffect(() => {
    if (!conversationId || !userId || !foreground) {
      return;
    }
    const controller = new AbortController();
    let fetching = false;
    let refreshRequested = false;
    const refresh = async () => {
      if (fetching) {
        refreshRequested = true;
        return;
      }
      fetching = true;
      try {
        const data = await fetchViewOnceReceipt(
          conversationId,
          mediaId,
          await apiOptions(),
          controller.signal
        );
        if (!controller.signal.aborted) {
          setState((current) => ({
            data:
              current.scope === scope && current.data?.seenAt
                ? current.data
                : data,
            scope,
          }));
          if (data.seenAt || data.unavailable) {
            clearInterval(timer);
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setState((current) => ({
            data: current.scope === scope ? current.data : undefined,
            error,
            scope,
          }));
          if (isViewOnceUnavailable(error)) {
            clearInterval(timer);
          }
        }
      }
      fetching = false;
      if (refreshRequested && !controller.signal.aborted) {
        refreshRequested = false;
        void refresh();
      }
    };
    const listener: ReceiptListener = (data) => {
      if (data) {
        setState({ data, scope });
        if (data.seenAt) {
          clearInterval(timer);
        }
      } else {
        void refresh();
      }
    };
    const listeners = observers.get(scope) ?? new Set<ReceiptListener>();
    listeners.add(listener);
    observers.set(scope, listeners);
    const timer = setInterval(() => {
      void refresh();
    }, 15_000);
    void refresh();
    return () => {
      controller.abort();
      clearInterval(timer);
      listeners.delete(listener);
      if (!listeners.size) {
        observers.delete(scope);
      }
    };
  }, [conversationId, foreground, mediaId, scope, userId]);
  const confirm = useCallback(
    (grantId: string) => {
      if (conversationId && userId) {
        void confirmReceipt(conversationId, mediaId, grantId, scope);
      }
    },
    [conversationId, mediaId, scope, userId]
  );
  return {
    confirm,
    data: state.scope === scope ? state.data : undefined,
    error: state.scope === scope ? state.error : undefined,
  };
}
