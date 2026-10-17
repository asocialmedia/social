"use client";

// oxlint-disable react/exhaustive-effect-dependencies -- Account, clear and retry revisions intentionally invalidate scoped effects even when they are not request payload fields.

import {
  runChatTask,
  throwChatError,
  incognitoIsActive,
  incognitoNotice,
} from "@asm/messages";
import type { ChatLifecycleSnapshot, IncognitoSession } from "@asm/messages";
import { Button } from "@asm/ui/shadui/button";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock3, Shield, RefreshCw } from "lucide-react";
import {
  useMemo,
  createContext,
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import type { ReactNode } from "react";

import { useSession } from "@/app/(main)/session-provider";
import { useMessagesIdentity } from "@/components/messages/message-identity-provider";
import {
  fetchChatLifecycle,
  mutateChatLifecycle,
} from "@/lib/messages/lifecycle-client";
import { offlineSearchWorkerClient } from "@/lib/messages/offline-search-worker-client";

import { IncognitoThread } from "./incognito-thread";

interface LifecycleContext {
  snapshot: ChatLifecycleSnapshot | undefined;
  error: string | null;
  busy: boolean;
  connected: boolean;
  revision: number;
  refresh: () => void;
  loadEarlierNotices: () => Promise<void>;
  mutate: (body: object) => Promise<boolean>;
  dismiss: () => void;
}
const Context = createContext<LifecycleContext | null>(null);
export function useChatLifecycle() {
  const context = useContext(Context);
  if (!context) {
    throwChatError(new Error("Chat lifecycle provider required"));
  }
  return context;
}

export function ChatLifecycleBoundary({
  conversationId,
  onBack,
  children,
}: {
  conversationId: string;
  onBack: () => void;
  children: ReactNode;
}) {
  const { user } = useSession();
  const userId = user?.id;
  const { recoveryGeneration } = useMessagesIdentity();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [revision, setRevision] = useState(0);
  const [clearRetry, setClearRetry] = useState(0);
  const [clock, setClock] = useState(Date.now);
  const [cacheClearedAt, setCacheClearedAt] = useState<string | null>(null);
  const [olderNotices, setOlderNotices] = useState<IncognitoSession[]>([]);
  const [olderCursor, setOlderCursor] = useState<string | null | undefined>();
  const query = useQuery({
    enabled: Boolean(userId),
    queryFn: ({ signal }) => fetchChatLifecycle(conversationId, signal),
    queryKey: ["chat-lifecycle", userId, conversationId],
    refetchInterval: (current) =>
      current.state.data?.activeSession || !connected ? 5000 : 30_000,
    refetchOnWindowFocus: "always",
    retry: 2,
  });
  const { refetch } = query;
  const refresh = useCallback(() => {
    void refetch();
    setRevision((n) => n + 1);
    setClearRetry((n) => n + 1);
  }, [refetch]);
  useEffect(() => {
    const clearedAt = query.data?.clearedAt;
    if (
      !clearedAt ||
      !userId ||
      recoveryGeneration === null ||
      cacheClearedAt === clearedAt
    ) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const cleared = await offlineSearchWorkerClient.clearConversation(
          { recoveryGeneration, userId },
          conversationId
        );
        if (!cleared) {
          throwChatError(
            new Error("Saved history couldn't be cleared. Retry while online.")
          );
        }
        queryClient.removeQueries({
          predicate: (item) =>
            item.queryKey[0] !== "chat-lifecycle" &&
            item.queryKey.includes(conversationId),
        });
        if (!cancelled) {
          setCacheClearedAt(clearedAt);
        }
      } catch {
        if (!cancelled) {
          setActionError(
            "Saved history couldn't be cleared. Please retry while online."
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    query.data?.clearedAt,
    userId,
    recoveryGeneration,
    cacheClearedAt,
    conversationId,
    queryClient,
    clearRetry,
  ]);
  useEffect(() => {
    const source = new EventSource(
      `/api/messages/conversations/${conversationId}/lifecycle/stream`
    );
    source.addEventListener("open", () => setConnected(true));
    let messageTimer: ReturnType<typeof setTimeout> | undefined;
    source.addEventListener("message", (event) => {
      try {
        const signal = JSON.parse(event.data) as { kind?: string };
        if (signal.kind === "keys.rotated") {
          if (!messageTimer) {
            messageTimer = setTimeout(() => {
              messageTimer = undefined;
              setRevision((n) => n + 1);
            }, 200);
          }
        } else {
          refresh();
        }
      } catch {
        refresh();
      }
    });
    source.addEventListener("error", () => {
      setConnected(false);
      setRevision((n) => n + 1);
    });
    const onOnline = () => refresh();
    window.addEventListener("online", onOnline);
    return () => {
      source.close();
      if (messageTimer) {
        clearTimeout(messageTimer);
      }
      window.removeEventListener("online", onOnline);
    };
  }, [conversationId, refresh]);
  // The one-second clock drives only the incognito remaining-time badge. It must not rerender
  // the normal thread every second, so it runs only while a session is active.
  const activeSessionId =
    query.data?.activeSession && !query.data.activeSession.endedAt
      ? query.data.activeSession.id
      : null;
  useEffect(() => {
    if (!activeSessionId) {
      return;
    }
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [activeSessionId]);
  const mutate = useCallback(
    async (body: object) => {
      if (busy) {
        return false;
      }
      setBusy(true);
      setActionError(null);
      return await runChatTask(
        async () => {
          try {
            const result = await mutateChatLifecycle(conversationId, body);
            queryClient.setQueryData(
              ["chat-lifecycle", userId, conversationId],
              result
            );
            setRevision((n) => n + 1);
            void queryClient.invalidateQueries({
              queryKey: ["message-conversations"],
            });
            if ("action" in body && body.action === "clear") {
              if (!userId || recoveryGeneration === null) {
                return false;
              }
              const cleared = await offlineSearchWorkerClient.clearConversation(
                { recoveryGeneration, userId },
                conversationId
              );
              if (!cleared) {
                throwChatError(
                  new Error(
                    "Saved history could not be cleared. Retry while online."
                  )
                );
              }
              queryClient.removeQueries({
                predicate: (item) =>
                  item.queryKey[0] !== "chat-lifecycle" &&
                  item.queryKey.includes(conversationId),
              });
              setCacheClearedAt(result.clearedAt);
              onBack();
            }
            return true;
          } catch (error) {
            setActionError(
              error instanceof Error
                ? error.message
                : "This action couldn't be completed. Try again."
            );
            refresh();
            return false;
          }
        },
        () => {
          setBusy(false);
        }
      );
    },
    [
      busy,
      conversationId,
      userId,
      queryClient,
      onBack,
      refresh,
      recoveryGeneration,
    ]
  );
  const snapshot = useMemo(
    () =>
      query.data
        ? {
            ...query.data,
            nextNoticeCursor:
              olderCursor === undefined
                ? query.data.nextNoticeCursor
                : olderCursor,
            notices: [...query.data.notices, ...olderNotices].filter(
              (notice, index, array) =>
                array.findIndex((n) => n.id === notice.id) === index
            ),
          }
        : undefined,
    [query.data, olderNotices, olderCursor]
  );
  const loadEarlierNotices = useCallback(async () => {
    const cursor =
      olderCursor === undefined ? query.data?.nextNoticeCursor : olderCursor;
    if (!cursor || busy) {
      return;
    }
    setBusy(true);
    return await runChatTask(
      async () => {
        try {
          const page = await fetchChatLifecycle(
            conversationId,
            undefined,
            cursor
          );
          setOlderNotices((previous) =>
            [...previous, ...page.notices].slice(-200)
          );
          setOlderCursor(page.nextNoticeCursor);
        } catch {
          setActionError(
            "Earlier session notices couldn't be loaded. Try again."
          );
        }
      },
      () => {
        setBusy(false);
      }
    );
  }, [olderCursor, query.data, busy, conversationId]);
  const offset = query.data
    ? Date.parse(query.data.serverNow) - query.dataUpdatedAt
    : 0;
  const active =
    snapshot?.activeSession &&
    incognitoIsActive(snapshot.activeSession, clock + offset)
      ? snapshot.activeSession
      : null;
  const lifecycleError =
    actionError ??
    (query.isError
      ? "Chat controls are unavailable. Check your connection and retry."
      : null);
  const pendingClear = Boolean(
    snapshot?.clearedAt &&
    recoveryGeneration !== null &&
    snapshot.clearedAt !== cacheClearedAt
  );
  const lifecycleContextValue = useMemo(
    () => ({
      busy,
      connected,
      dismiss: () => setActionError(null),
      error: lifecycleError,
      loadEarlierNotices,
      mutate,
      refresh,
      revision,
      snapshot,
    }),
    [
      busy,
      connected,
      lifecycleError,
      loadEarlierNotices,
      mutate,
      refresh,
      revision,
      snapshot,
    ]
  );
  return (
    <Context.Provider value={lifecycleContextValue}>
      {(() => {
        if (!snapshot || pendingClear) {
          return (
            <div
              className="flex h-full flex-1 flex-col items-center justify-center gap-3 p-6 text-center"
              aria-live="polite"
            >
              <Shield className="text-muted-foreground size-7" />
              <p>
                {lifecycleError ??
                  (pendingClear
                    ? "Clearing saved history…"
                    : "Opening conversation…")}
              </p>
              {lifecycleError ? (
                <Button variant="premium" onClick={refresh}>
                  <RefreshCw className="mr-2 size-4" />
                  Retry
                </Button>
              ) : null}
            </div>
          );
        }
        if (active) {
          return (
            <IncognitoThread
              key={`${active.id}:${recoveryGeneration}`}
              conversationId={conversationId}
              session={active}
              serverNow={snapshot.serverNow}
              fresh={clock - query.dataUpdatedAt < 7000}
              revision={revision}
              onBack={onBack}
              onRefresh={refresh}
              onEnd={() =>
                mutate({ action: "end-incognito", sessionId: active.id })
              }
              busy={busy}
              error={lifecycleError}
            />
          );
        }
        return (
          <Fragment key={snapshot.clearedAt ?? "normal-history"}>
            {children}
          </Fragment>
        );
      })()}
    </Context.Provider>
  );
}

export function IncognitoUsageNotice({
  session,
}: {
  session: IncognitoSession;
}) {
  const ended = session.endedAt;
  const effective =
    ended && !session.endedAt
      ? { ...session, endReason: "timeout", endedAt: ended }
      : session;
  return (
    <div
      className="mx-auto my-4 max-w-md px-4"
      data-incognito-notice={session.id}
    >
      <div className="surface-3d rounded-2xl! px-4 py-3 text-center">
        <div className="text-muted-foreground mb-1 flex items-center justify-center gap-1.5 text-[11px] font-medium tracking-widest uppercase">
          <Shield className="size-3" />
          Incognito session
        </div>
        <p className="text-sm">{incognitoNotice(effective)}</p>
        <p className="text-muted-foreground mt-1 flex items-center justify-center gap-1 text-xs">
          <Clock3 className="size-3" />
          <time dateTime={session.startedAt}>
            {new Date(session.startedAt).toLocaleString()}
          </time>
          {ended ? (
            <>
              {" "}
              —{" "}
              <time dateTime={ended}>
                {new Date(ended).toLocaleTimeString()}
              </time>
            </>
          ) : null}
        </p>
        <p className="text-muted-foreground mt-1 text-[11px]">
          Permanent notice · Session messages are not retained after it ends
        </p>
      </div>
    </div>
  );
}
