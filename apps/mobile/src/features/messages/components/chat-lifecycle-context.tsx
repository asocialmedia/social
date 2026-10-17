import {
  observeChatTask,
  runChatTask,
  throwChatError,
  incognitoIsActive,
  incognitoNotice,
} from "@asm/messages";
import type { ChatLifecycleSnapshot, IncognitoSession } from "@asm/messages";
import { fetch as streamingFetch } from "expo/fetch";
// oxlint-disable react/exhaustive-effect-dependencies -- Account, clear and retry revisions intentionally invalidate scoped effects even when they are not request payload fields.
import {
  useMemo,
  createContext,
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { authClient } from "@/features/auth/lib/auth-client";
import { useSessionContext } from "@/features/auth/state/session";
import type { ApiCallOptions } from "@/features/feed/lib/feed-api";
import {
  nativeChatRequest,
  nativeLifecycle,
} from "@/features/messages/lib/lifecycle-client";
import { readMessageStream } from "@/features/messages/lib/realtime";
import { purgeCachedConversation } from "@/features/messages/state/message-cache";
import { useMessagesForeground } from "@/features/messages/state/use-messages-foreground";
import { getApiBaseUrl } from "@/lib/api-env";
import { useAppTheme } from "@/theme";

import { NativeIncognitoThread } from "./incognito-thread";

interface NativeLifecycleContext {
  snapshot: ChatLifecycleSnapshot | null;
  error: string | null;
  busy: boolean;
  revision: number;
  options: ApiCallOptions | null;
  refresh: () => void;
  mutate: (body: object) => Promise<boolean>;
  loadEarlierNotices: () => Promise<void>;
}
const Context = createContext<NativeLifecycleContext | null>(null);
export function useNativeChatLifecycle() {
  const value = useContext(Context);
  if (!value) {
    throwChatError(new Error("Chat lifecycle provider required"));
  }
  return value;
}
export function NativeChatLifecycleBoundary({
  conversationId,
  onBack,
  children,
}: {
  conversationId: string;
  onBack: () => void;
  children: ReactNode;
}) {
  const { user } = useSessionContext();
  const { theme } = useAppTheme();
  const foreground = useMessagesForeground();
  const [options, setOptions] = useState<ApiCallOptions | null>(null);
  const [snapshot, setSnapshot] = useState<ChatLifecycleSnapshot | null>(null);
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [contentRevision, setContentRevision] = useState(0);
  const [connected, setConnected] = useState(false);
  const [clock, setClock] = useState(Date.now);
  const [fetchedAt, setFetchedAt] = useState(0);
  const [offset, setOffset] = useState(0);
  const clearAt = useRef<string | null>(null);
  const snapshotRef = useRef<ChatLifecycleSnapshot | null>(null);
  const noticeHistory = useRef<{
    notices: IncognitoSession[];
    cursor: string | null;
  } | null>(null);
  useEffect(() => {
    let cancelled = false;
    void observeChatTask(authClient.getCookie(), (cookie) => {
      if (!cancelled) {
        setOptions({
          apiBase: getApiBaseUrl(),
          baseFetch: fetch,
          cookie: cookie ?? undefined,
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    if (!options || !foreground) {
      return;
    }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () =>
      await runChatTask(
        async () => {
          try {
            const next = await nativeLifecycle(
              conversationId,
              options,
              controller.signal
            );
            if (next.clearedAt && next.clearedAt !== clearAt.current) {
              await purgeCachedConversation(conversationId);
              clearAt.current = next.clearedAt;
            }
            if (!controller.signal.aborted) {
              const history = noticeHistory.current;
              const merged = history
                ? {
                    ...next,
                    nextNoticeCursor: history.cursor,
                    notices: [...next.notices, ...history.notices].filter(
                      (notice, index, notices) =>
                        notices.findIndex((item) => item.id === notice.id) ===
                        index
                    ),
                  }
                : next;
              snapshotRef.current = merged;
              setSnapshot(merged);
              setLifecycleError(null);
              setFetchedAt(Date.now());
              setOffset(Date.parse(next.serverNow) - Date.now());
            }
          } catch (error) {
            if (!controller.signal.aborted) {
              setLifecycleError(
                error instanceof Error
                  ? error.message
                  : "Chat controls are unavailable. Retry."
              );
            }
          }
        },
        () => {
          if (!controller.signal.aborted) {
            timer = setTimeout(
              () => {
                void load();
              },
              connected && !snapshotRef.current?.activeSession ? 30_000 : 5000
            );
          }
        }
      );
    void load();
    return () => {
      controller.abort();
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [conversationId, options, foreground, revision, connected]);
  useEffect(() => {
    if (!options || !foreground) {
      return;
    }
    const controller = new AbortController();
    void observeChatTask(
      readMessageStream({
        baseFetch: streamingFetch,
        cookie: options.cookie,
        onConnect: () => {
          setConnected(true);
          refresh();
        },
        onEvent: (event) => {
          if (event.kind === "keys.rotated") {
            setContentRevision((value) => value + 1);
          } else {
            refresh();
          }
        },
        onStatusChange: (status) => {
          if (status !== "live") {
            setConnected(false);
          }
        },
        signal: controller.signal,
        url: `${options.apiBase}/api/messages/conversations/${conversationId}/lifecycle/stream`,
      }),
      () => {
        // This task has no success update.
      },
      () => {
        if (!controller.signal.aborted) {
          setConnected(false);
        }
      }
    );
    return () => {
      controller.abort();
    };
  }, [options, conversationId, foreground, refresh]);
  const activeSessionId =
    snapshot?.activeSession && !snapshot.activeSession.endedAt
      ? snapshot.activeSession.id
      : null;
  useEffect(() => {
    if (!activeSessionId || !foreground) {
      return;
    }
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [activeSessionId, foreground]);
  const mutate = useCallback(
    async (body: object) => {
      if (!options || busy) {
        return false;
      }
      setBusy(true);
      setLifecycleError(null);
      return await runChatTask(
        async () => {
          try {
            const next = await nativeChatRequest<ChatLifecycleSnapshot>(
              conversationId,
              "lifecycle",
              options,
              { body: JSON.stringify(body), method: "POST" }
            );
            if (next.clearedAt && next.clearedAt !== clearAt.current) {
              await purgeCachedConversation(conversationId);
              clearAt.current = next.clearedAt;
            }
            snapshotRef.current = next;
            setSnapshot(next);
            setFetchedAt(Date.now());
            setOffset(Date.parse(next.serverNow) - Date.now());
            refresh();
            if ("action" in body && body.action === "clear") {
              onBack();
            }
            return true;
          } catch (error) {
            setLifecycleError(
              error instanceof Error
                ? error.message
                : "This action couldn't be completed. Retry."
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
    [options, busy, conversationId, onBack, refresh]
  );
  const loadEarlierNotices = useCallback(async () => {
    const { current } = snapshotRef;
    if (!current?.nextNoticeCursor || !options || busy) {
      return;
    }
    setBusy(true);
    return await runChatTask(
      async () => {
        try {
          const page = await nativeLifecycle(
            conversationId,
            options,
            undefined,
            current.nextNoticeCursor ?? undefined
          );
          const next = {
            ...current,
            nextNoticeCursor: page.nextNoticeCursor,
            notices: [...current.notices, ...page.notices].slice(-220),
          };
          noticeHistory.current = {
            cursor: page.nextNoticeCursor,
            notices: next.notices.slice(-200),
          };
          snapshotRef.current = next;
          setSnapshot(next);
        } catch {
          setLifecycleError(
            "Earlier session notices couldn't be loaded. Retry."
          );
        }
      },
      () => {
        setBusy(false);
      }
    );
  }, [options, busy, conversationId]);
  const active =
    snapshot?.activeSession &&
    incognitoIsActive(snapshot.activeSession, clock + offset)
      ? snapshot.activeSession
      : null;
  const lifecycleContextValue = useMemo(
    () => ({
      busy,
      error: lifecycleError,
      loadEarlierNotices,
      mutate,
      options,
      refresh,
      revision,
      snapshot,
    }),
    [
      busy,
      lifecycleError,
      loadEarlierNotices,
      mutate,
      options,
      refresh,
      revision,
      snapshot,
    ]
  );
  return (
    <Context.Provider value={lifecycleContextValue}>
      {(() => {
        if (!snapshot || !options) {
          return (
            <View
              style={{
                alignItems: "center",
                backgroundColor: theme.containerBg,
                flex: 1,
                gap: 12,
                justifyContent: "center",
                padding: 24,
              }}
            >
              {lifecycleError ? (
                <>
                  <Text style={{ color: theme.inputText }}>
                    {lifecycleError}
                  </Text>
                  <Pressable accessibilityRole="button" onPress={refresh}>
                    <Text style={{ color: theme.inputText }}>Retry</Text>
                  </Pressable>
                </>
              ) : (
                <ActivityIndicator accessibilityLabel="Opening conversation" />
              )}
            </View>
          );
        }
        if (active) {
          return (
            <NativeIncognitoThread
              key={active.id}
              conversationId={conversationId}
              session={active}
              options={options}
              revision={revision + contentRevision}
              fresh={foreground && clock - fetchedAt < 7000}
              serverOffset={offset}
              onRefresh={refresh}
              onBack={onBack}
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

export function NativeIncognitoUsageNotice({
  session,
}: {
  session: IncognitoSession;
}) {
  const { theme } = useAppTheme();
  const ended =
    session.endedAt ??
    (session.endReason === "timeout" ? session.expiresAt : null);
  const effective =
    ended && !session.endedAt
      ? { ...session, endReason: "timeout", endedAt: ended }
      : session;
  return (
    <View
      accessibilityLabel={incognitoNotice(effective)}
      style={{
        backgroundColor: theme.cardBg,
        borderColor: theme.dividerLine,
        borderRadius: 16,
        borderWidth: 1,
        marginHorizontal: 24,
        marginVertical: 12,
        padding: 14,
      }}
    >
      <Text
        style={{
          color: theme.inputText,
          fontFamily: "SofiaProBold",
          fontSize: 13,
          textAlign: "center",
        }}
      >
        {incognitoNotice(effective)}
      </Text>
      <Text
        style={{
          color: theme.dividerText,
          fontSize: 11,
          marginTop: 5,
          textAlign: "center",
        }}
      >
        {new Date(session.startedAt).toLocaleString()}
        {ended ? ` — ${new Date(ended).toLocaleTimeString()}` : ""}
      </Text>
      <Text
        style={{
          color: theme.dividerText,
          fontSize: 10,
          marginTop: 4,
          textAlign: "center",
        }}
      >
        Permanent usage notice
      </Text>
    </View>
  );
}
