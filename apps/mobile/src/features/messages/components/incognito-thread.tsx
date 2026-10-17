// oxlint-disable react/exhaustive-effect-dependencies -- Account, clear and retry revisions intentionally invalidate scoped effects even when they are not request payload fields.
import {
  observeChatTask,
  throwChatError,
  incognitoTimeRemaining,
  extractMessageReferences,
} from "@asm/messages";
import type { IncognitoMessage, IncognitoSession } from "@asm/messages";
// oxlint-disable no-await-in-loop -- Sequential cryptography, database mutations and bounded streams preserve ordering and memory limits.
import { randomUUID } from "expo-crypto";
import { Image } from "expo-image";
import { ArrowLeft, Shield } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useSessionContext } from "@/features/auth/state/session";
import type { ApiCallOptions } from "@/features/feed/lib/feed-api";
import {
  ensureConversationKeys,
  fetchConversationDetail,
  postConversationKeys,
} from "@/features/messages/lib/client";
import { decryptMessage, encryptMessage } from "@/features/messages/lib/crypto";
import type { MessagePayload } from "@/features/messages/lib/crypto";
import { deriveNativeIncognitoRootKey } from "@/features/messages/lib/incognito-crypto";
import {
  NativeChatControlError,
  nativeChatRequest,
  nativeIncognitoPage,
} from "@/features/messages/lib/lifecycle-client";
import { useMessagesIdentity } from "@/features/messages/state/message-identity";

import { MessageComposer } from "./message-composer";

interface Row {
  message: IncognitoMessage;
  payload: MessagePayload | null;
}
export function NativeIncognitoThread({
  conversationId,
  session,
  options,
  revision,
  fresh,
  serverOffset,
  onRefresh,
  onBack,
  onEnd,
  busy,
  error: lifecycleError,
}: {
  conversationId: string;
  session: IncognitoSession;
  options: ApiCallOptions;
  revision: number;
  fresh: boolean;
  serverOffset: number;
  onRefresh: () => void;
  onBack: () => void;
  onEnd: () => Promise<boolean>;
  busy: boolean;
  error: string | null;
}) {
  const { user } = useSessionContext();
  const { privateKey, getBaseKeys, invalidateKeys, mediaCookie } =
    useMessagesIdentity();
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState<Row[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [latest, setLatest] = useState(true);
  const [localError, setLocalError] = useState<string | null>(null);
  const [clock, setClock] = useState(Date.now);
  const mounted = useRef(true);
  const generation = useRef(0);
  const pending = useRef<{ id: string; signature: string } | null>(null);
  const list = useRef<FlatList<Row>>(null);
  const canView = fresh && Date.parse(session.expiresAt) > clock + serverOffset;
  useEffect(() => {
    mounted.current = true;
    const timer = setInterval(() => setClock(Date.now()), 1000);
    const back = BackHandler.addEventListener("hardwareBackPress", () => {
      onBack();
      return true;
    });
    return () => {
      mounted.current = false;
      generation.current += 1;
      clearInterval(timer);
      back.remove();
    };
  }, [onBack]);
  const load = useCallback(
    async (signal: AbortSignal, before?: number) => {
      generation.current += 1;
      const { current } = generation;
      const page = await nativeIncognitoPage(
        conversationId,
        session.id,
        options,
        signal,
        before
      );
      invalidateKeys(conversationId);
      const awaitedChatState0 = await getBaseKeys(conversationId);
      const roots = awaitedChatState0.map((root) =>
        deriveNativeIncognitoRootKey(root, session.id)
      );
      const decoded: Row[] = [];
      for (const message of page.messages) {
        let payload: MessagePayload | null = null;
        for (const root of roots) {
          try {
            payload = await decryptMessage(
              root,
              message.senderId,
              session.id,
              message
            );
            break;
          } catch {
            // Reconcile safely on the next request; do not expose source errors.
          }
        }
        decoded.push({ message, payload });
      }
      if (
        signal.aborted ||
        !mounted.current ||
        current !== generation.current
      ) {
        return;
      }
      setRows((previous) =>
        before === undefined
          ? decoded
          : [...decoded, ...previous]
              .filter(
                (row, index, array) =>
                  array.findIndex(
                    (candidate) => candidate.message.id === row.message.id
                  ) === index
              )
              .slice(0, 200)
      );
      setHasMore(page.hasMore);
      setLoading(false);
      setLocalError(null);
      if (before === undefined) {
        requestAnimationFrame(() =>
          list.current?.scrollToEnd({ animated: false })
        );
      }
    },
    [conversationId, session.id, options, getBaseKeys, invalidateKeys]
  );
  useEffect(() => {
    if (!canView) {
      generation.current += 1;
      queueMicrotask(() => setRows([]));
      return;
    }
    if (!latest) {
      return;
    }
    const controller = new AbortController();
    void observeChatTask(
      load(controller.signal),
      () => {
        // This task has no success update.
      },
      (requestFailure) => {
        if (!controller.signal.aborted && mounted.current) {
          setRows([]);
          setLoading(false);
          setLocalError(
            requestFailure instanceof Error
              ? requestFailure.message
              : "Messages couldn't be loaded. Retry."
          );
        }
      }
    );
    return () => controller.abort();
  }, [canView, latest, revision, session.nextSequence, load]);
  const send = async (payload: MessagePayload) => {
    if (!user || !privateKey || !canView) {
      throwChatError(new Error("Reconnect before sending in incognito."));
    }
    try {
      let detail = await fetchConversationDetail(conversationId, options);
      const root = await ensureConversationKeys(
        detail.conversation,
        privateKey,
        user.id,
        {
          postKeys: (id, keys) => postConversationKeys(id, keys, options),
          refreshConversation: async () => {
            const refreshed = await fetchConversationDetail(
              conversationId,
              options
            );
            return refreshed.conversation;
          },
        }
      );
      if (!root) {
        throwChatError(
          new Error("Message keys are unavailable. Please retry.")
        );
      }
      detail = await fetchConversationDetail(conversationId, options);
      const version = Math.max(
        ...detail.keys
          .filter((key) => key.ownerUserId === user.id)
          .map((key) => key.version ?? 1)
      );
      invalidateKeys(conversationId);
      const roots = await getBaseKeys(conversationId);
      if (!roots[0] || !Number.isSafeInteger(version)) {
        throwChatError(
          new Error("Message keys are unavailable. Please retry.")
        );
      }
      const sessionRoot = deriveNativeIncognitoRootKey(roots[0], session.id);
      const signature = JSON.stringify(payload);
      if (!pending.current || pending.current.signature !== signature) {
        pending.current = { id: randomUUID(), signature };
      }
      const messageId = pending.current.id;
      let index = Math.max(
        session.nextSequence,
        (rows.at(-1)?.message.sequence ?? -1) + 1
      );
      for (let attempt = 0; ; attempt += 1) {
        const encrypted = await encryptMessage(
          sessionRoot,
          user.id,
          index,
          session.id,
          payload
        );
        try {
          await nativeChatRequest(conversationId, "incognito", options, {
            body: JSON.stringify({
              ...encrypted,
              id: messageId,
              keyEpoch: version,
              mediaIds: extractMessageReferences(payload).flatMap((ref) =>
                ref.kind === "media" && ref.requiredId ? [ref.requiredId] : []
              ),
              sessionId: session.id,
            }),
            method: "POST",
          });
          break;
        } catch (error) {
          if (
            error instanceof NativeChatControlError &&
            error.expectedIndex !== undefined &&
            attempt < 2
          ) {
            index = error.expectedIndex;
            continue;
          }
          throwChatError(error);
        }
      }
      pending.current = null;
      if (mounted.current) {
        setLatest(true);
        setLocalError(null);
        onRefresh();
      }
    } catch (error) {
      if (mounted.current) {
        setLocalError(
          error instanceof Error
            ? error.message
            : "Message couldn't be sent. Retry."
        );
        onRefresh();
      }
      throwChatError(error);
    }
  };
  const end = () =>
    Alert.alert(
      "End incognito for both of you?",
      "All messages and attachments in this session will be deleted, including unread messages. A permanent usage notice remains.",
      [
        { style: "cancel", text: "Keep chatting" },
        {
          onPress: () => {
            void onEnd();
          },
          style: "destructive",
          text: "End and delete",
        },
      ]
    );
  const loadEarlier = async () => {
    const before = rows[0]?.message.sequence;
    if (before === undefined) {
      return;
    }
    setLatest(false);
    setLoading(true);
    try {
      await load(new AbortController().signal, before);
    } catch {
      setLocalError("Earlier messages couldn't be loaded. Retry.");
      setLoading(false);
    }
  };
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={{
        backgroundColor: "#09090b",
        flex: 1,
        paddingBottom: insets.bottom,
        paddingLeft: insets.left,
        paddingRight: insets.right,
        paddingTop: insets.top,
      }}
    >
      <View
        style={{
          alignItems: "center",
          borderBottomColor: "#27272a",
          borderBottomWidth: 1,
          flexDirection: "row",
          gap: 12,
          minHeight: 64,
          paddingHorizontal: 14,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to inbox; keep incognito active"
          hitSlop={12}
          onPress={onBack}
        >
          <ArrowLeft color="#f4f4f5" size={22} />
        </Pressable>
        <Shield color="#d4d4d8" size={24} />
        <View style={{ flex: 1 }}>
          <Text
            style={{
              color: "#f4f4f5",
              fontFamily: "SofiaProBold",
              fontSize: 16,
            }}
          >
            Incognito
          </Text>
          <Text style={{ color: "#a1a1aa", fontSize: 12 }}>
            {incognitoTimeRemaining(session.expiresAt, clock + serverOffset)}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={end}
          style={{
            borderColor: "#3f3f46",
            borderRadius: 16,
            borderWidth: 1,
            padding: 12,
          }}
        >
          <Text style={{ color: "#f4f4f5", fontSize: 12 }}>End incognito</Text>
        </Pressable>
      </View>
      <Text
        style={{
          color: "#a1a1aa",
          fontSize: 11,
          lineHeight: 16,
          padding: 12,
          textAlign: "center",
        }}
      >
        Everything here is deleted when either person ends the session or the
        timer runs out. A permanent usage notice stays in your normal chat.
      </Text>
      {(() => {
        if (canView) {
          if (loading && !rows.length) {
            return (
              <View style={{ flex: 1, justifyContent: "center" }}>
                <ActivityIndicator
                  color="#a1a1aa"
                  accessibilityLabel="Opening incognito messages"
                />
              </View>
            );
          }
          return (
            <FlatList
              ref={list}
              data={rows}
              keyExtractor={(row) => row.message.id}
              keyboardShouldPersistTaps="handled"
              maintainVisibleContentPosition={{ minIndexForVisible: 1 }}
              contentContainerStyle={{ flexGrow: 1, gap: 10, padding: 16 }}
              ListHeaderComponent={
                hasMore ? (
                  <Pressable
                    accessibilityRole="button"
                    disabled={loading}
                    onPress={() => {
                      void loadEarlier();
                    }}
                  >
                    <Text
                      style={{
                        color: "#a1a1aa",
                        padding: 12,
                        textAlign: "center",
                      }}
                    >
                      Load earlier messages
                    </Text>
                  </Pressable>
                ) : null
              }
              ListEmptyComponent={
                <View
                  style={{
                    alignItems: "center",
                    flex: 1,
                    gap: 12,
                    justifyContent: "center",
                  }}
                >
                  <Shield size={40} color="#71717a" />
                  <Text
                    style={{
                      color: "#f4f4f5",
                      fontFamily: "SofiaProBold",
                      fontSize: 18,
                    }}
                  >
                    A conversation for the moment
                  </Text>
                  <Text style={{ color: "#a1a1aa", textAlign: "center" }}>
                    Your normal history is waiting outside this session.
                  </Text>
                </View>
              }
              renderItem={({ item: { message, payload } }) => (
                <View
                  style={{
                    alignItems:
                      message.senderId === user?.id ? "flex-end" : "flex-start",
                  }}
                >
                  <View
                    style={{
                      backgroundColor:
                        message.senderId === user?.id ? "#e4e4e7" : "#27272a",
                      borderRadius: 18,
                      maxWidth: "85%",
                      padding: 12,
                    }}
                  >
                    {payload?.type === "media"
                      ? ("images" in payload
                          ? payload.images
                          : [{ url: payload.url }]
                        ).map((image, index) => (
                          <Image
                            key={`${message.id}:${index}`}
                            cachePolicy="none"
                            source={{
                              headers: mediaCookie
                                ? { Cookie: mediaCookie }
                                : undefined,
                              uri: image.url.startsWith("/")
                                ? `${options.apiBase}${image.url}`
                                : image.url,
                            }}
                            style={{
                              borderRadius: 12,
                              height: 200,
                              marginBottom: 6,
                              width: 220,
                            }}
                            contentFit="contain"
                          />
                        ))
                      : null}
                    <Text
                      style={{
                        color:
                          message.senderId === user?.id ? "#09090b" : "#f4f4f5",
                        fontSize: 14,
                        lineHeight: 20,
                      }}
                    >
                      {payload?.content ??
                        (payload
                          ? ""
                          : "This message couldn't be decrypted on this account.")}
                    </Text>
                    <Text
                      style={{
                        color:
                          message.senderId === user?.id ? "#52525b" : "#a1a1aa",
                        fontSize: 10,
                        marginTop: 4,
                        textAlign: "right",
                      }}
                    >
                      {new Date(message.createdAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </Text>
                  </View>
                </View>
              )}
            />
          );
        }
        return (
          <View
            style={{
              alignItems: "center",
              flex: 1,
              gap: 12,
              justifyContent: "center",
              padding: 24,
            }}
          >
            <Shield color="#71717a" size={36} />
            <Text style={{ color: "#d4d4d8", textAlign: "center" }}>
              Reconnect to view this session. The timer keeps running.
            </Text>
            <Pressable accessibilityRole="button" onPress={onRefresh}>
              <Text style={{ color: "#fff", padding: 12 }}>
                Retry connection
              </Text>
            </Pressable>
          </View>
        );
      })()}
      {latest ? null : (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setLatest(true);
            onRefresh();
          }}
        >
          <Text style={{ color: "#a1a1aa", padding: 10, textAlign: "center" }}>
            Return to latest messages
          </Text>
        </Pressable>
      )}
      {localError || lifecycleError ? (
        <Pressable
          accessibilityRole="button"
          onPress={onRefresh}
          style={{ padding: 12 }}
        >
          <Text
            accessibilityRole="alert"
            style={{ color: "#fcd34d", textAlign: "center" }}
          >
            {localError ?? lifecycleError} Tap to retry.
          </Text>
        </Pressable>
      ) : null}
      <MessageComposer
        conversationId={conversationId}
        incognitoSessionId={session.id}
        disabled={!canView || busy}
        editing={null}
        onCancelEdit={() => {
          // No action is required here.
        }}
        onCancelReply={() => {
          // No action is required here.
        }}
        onSend={send}
        onTyping={() => {
          // No action is required here.
        }}
        replyTo={null}
        peerName="in incognito"
      />
    </KeyboardAvoidingView>
  );
}
