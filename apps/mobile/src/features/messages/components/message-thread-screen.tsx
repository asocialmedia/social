// The message thread: a scrolling transcript, the header, and the composer.
//
// Ported from apps/web/src/components/messages/message-thread.tsx (5468 lines on
// web), restructured for a list rather than a virtualiser.
//
// THE PORTING DECISION THAT SHAPED EVERYTHING ELSE: web virtualises a flat row
// list with measured heights because a browser cannot render a 500-row chat. A
// FlatList does that natively, so the virtualiser, its scroll anchoring and its
// measurement loop are gone and the transcript is an INVERTED list -- which starts
// at the newest message with no scroll-to-bottom on mount, and turns "page older
// history" into onEndReached.
//
// READ STATE has the real subtlety. The server's read route also advances the
// delivery watermark, and a thread that is open but scrolled into history must not
// claim the reader saw rows they did not. So the marker tracks the newest PEER row
// and is only advanced while the transcript is at the live end.
//
// SEND is where the ratchet matters. The server owns the ratchet index and rejects
// a send whose index it has already advanced past, answering 409 with the index it
// wanted. On a phone that is routine -- two taps, or a retry after a tunnel -- so it
// is retried once silently instead of surfaced as an error.

import { ArrowLeft, ShieldCheck } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  View,
  Pressable,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { UserAvatar } from "@/components/avatar/user-avatar";
import { authClient } from "@/features/auth/lib/auth-client";
import { useInstall } from "@/features/auth/state/install";
import { useSessionContext } from "@/features/auth/state/session";
import type { ApiCallOptions } from "@/features/feed/lib/feed-api";
import {
  MessagesApiError,
  ackMessageDelivered,
  createRootKeyStore,
  ensureConversationKeys,
  fetchConversationDetail,
  markConversationRead,
  postConversationKeys,
  sendEncryptedMessage,
  sendTypingIndicator,
} from "@/features/messages/lib/client";
import { resolveConversationTheme } from "@/features/messages/lib/conversation-theme";
import {
  derivePublicKeyFromPrivate,
  generateFingerprint,
  getMediaImages,
} from "@/features/messages/lib/crypto";
import type { MessagePayload } from "@/features/messages/lib/crypto";
import { messageDecryptor } from "@/features/messages/lib/decryptor";
import type {
  DecryptEntry,
  DecryptItem,
} from "@/features/messages/lib/decryptor";
import {
  formatTimeDivider,
  getMessageGroupMeta,
} from "@/features/messages/lib/message-grouping";
import { getMessageReceipt } from "@/features/messages/lib/message-receipts";
import { surface3d } from "@/features/messages/lib/message-recipes";
import type { MessageData } from "@/features/messages/lib/types";
import { UNREAD_DIVIDER_LABEL } from "@/features/messages/lib/unread-marker";
import { conversationListStore } from "@/features/messages/state/conversation-list-store";
import { useMessagesIdentity } from "@/features/messages/state/message-identity";
import {
  transcriptStore,
  unreadBoundaryId,
} from "@/features/messages/state/transcript-store";
import { useTranscript } from "@/features/messages/state/use-messages-data";
import { useMessagesForeground } from "@/features/messages/state/use-messages-foreground";
import { getApiBaseUrl } from "@/lib/api-env";
import { reversedCopy } from "@/lib/ordered-copy";
import { SHOWS_SCROLL_INDICATOR } from "@/lib/scroll-indicator";
import { logWarn } from "@/lib/telemetry";
import { useAppTheme } from "@/theme";

import { setRootKeyResolver } from "./conversation-list-screen";
import { MessageBubble } from "./message-bubble";
import { MessageComposer, reclaimOwnMedia } from "./message-composer";
import type { ComposerTarget } from "./message-composer";
import { MessageIdentityLocked } from "./message-identity-locked";
import { MessageMediaViewer } from "./message-media-viewer";
import { MessagesIconButton } from "./messages-primitives";
import { TypingDots } from "./typing-dots";

// The widest a bubble may be. On web this is a percentage of the transcript; here
// it is a point value the screen passes in, because a phone's width is the thing
// being bounded.
const MAX_BUBBLE_WIDTH = 320;

// A row that is no longer in the loaded window (a stale index during a trim)
// renders as a self-contained group rather than throwing.
const SELF_GROUP = {
  isFirstInGroup: true,
  isLastInGroup: true,
  showTimeDivider: false,
};

type TranscriptItem =
  | { key: string; kind: "message"; message: MessageData }
  | { key: string; kind: "divider"; label: string }
  | { key: string; kind: "unread" };

export function MessageThreadScreen({
  conversationId,
  onBack,
}: {
  conversationId: string;
  onBack: () => void;
}) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { user } = useSessionContext();
  const { runWithInstallToken } = useInstall();
  const {
    error: identityError,
    privateKey,
    reset: resetIdentity,
    retry,
    status,
  } = useMessagesIdentity();
  const userId = user?.id ?? null;
  const transcript = useTranscript(conversationId);

  const [peer, setPeer] = useState<{
    avatarUrl: string | null;
    displayName: string;
    publicKey: string | null;
  } | null>(null);
  const [themeKey, setThemeKey] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<ComposerTarget | null>(null);
  const [editing, setEditing] = useState<ComposerTarget | null>(null);
  const [viewer, setViewer] = useState<{
    images: string[];
    index: number;
  } | null>(null);
  const readTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The resolved root key for THIS conversation, memoised on a signature of the
  // wraps and the peer's public key. Keying on the conversation alone was wrong: a
  // peer identity reset republishes wraps under the SAME conversation id, so the
  // cached roots came back unchanged and decryption continued with a superseded
  // key.
  const rootKeys = useRef<{ keys: Uint8Array[]; signature: string } | null>(
    null
  );

  const chatTheme = useMemo(
    () => resolveConversationTheme(themeKey),
    [themeKey]
  );

  const foreground = useMessagesForeground();
  const [detailError, setDetailError] = useState(false);
  const [detailRevision, setDetailRevision] = useState(0);
  const cachedPeer = conversationListStore
    .getSnapshot()
    .rows.find((row) => row.conversation.id === conversationId);

  const apiOptions = useCallback(async (): Promise<ApiCallOptions> => {
    const cookie = await authClient.getCookie();
    return {
      apiBase: getApiBaseUrl(),
      baseFetch: fetch,
      cookie: cookie ?? undefined,
    };
  }, []);

  // ---- keys ------------------------------------------------------------------

  const getBaseKeys = useCallback(
    async (target: string): Promise<Uint8Array[]> => {
      if (!privateKey || target !== conversationId) {
        return [];
      }
      const options = await apiOptions();
      const detail = await fetchConversationDetail(conversationId, options);
      const peerMember = detail.conversation.members.find(
        (member) => member.userId !== userId
      );
      const peerPublicKey = peerMember?.user.messageIdentity?.publicKey;
      if (!peerPublicKey) {
        return [];
      }
      // A legacy wrap row has no explicit version, which means epoch 1. The
      // signature therefore normalises it rather than reading `undefined`.
      const myWraps = detail.keys
        .filter((key) => key.ownerUserId === userId)
        .map((key) => ({ ...key, version: key.version ?? 1 }));
      const signature = `${myWraps
        .map(
          (key) =>
            `${key.version ?? 1}:${key.encryptedKey.ciphertext}:${key.encryptedKey.iv}`
        )
        .join("|")}#${peerPublicKey}`;
      if (rootKeys.current?.signature === signature) {
        return rootKeys.current.keys;
      }
      const store = createRootKeyStore(privateKey);
      const keys = await store.getRootKeys(
        conversationId,
        myWraps,
        peerPublicKey
      );
      rootKeys.current = { keys, signature };
      return keys;
    },
    [apiOptions, conversationId, privateKey, userId]
  );

  // The conversation list needs the same resolver, so the row previews use one key
  // path rather than a second implementation that could disagree.
  useEffect(() => {
    setRootKeyResolver(getBaseKeys);
  }, [getBaseKeys]);

  // ---- peer detail + key healing ---------------------------------------------

  useEffect(() => {
    if (!userId || !foreground) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const options = await apiOptions();
        const detail = await fetchConversationDetail(conversationId, options);
        if (cancelled) {
          return;
        }
        const peerMember = detail.conversation.members.find(
          (member) => member.userId !== userId
        );
        const mine = detail.conversation.members.find(
          (member) => member.userId === userId
        );
        setDetailError(false);
        setPeer({
          avatarUrl: peerMember?.user.avatarUrl ?? null,
          displayName:
            peerMember?.user.displayName || peerMember?.user.username || "Chat",
          publicKey: peerMember?.user.messageIdentity?.publicKey ?? null,
        });
        setThemeKey(mine?.themeKey ?? null);

        // Guarantee a wrapped key exists for both members before the first send.
        // Without this the first message goes out under a key the peer has never
        // seen and they read nothing.
        if (!privateKey) {
          return;
        }
        await ensureConversationKeys(detail.conversation, privateKey, userId, {
          postKeys: (target, keys) =>
            postConversationKeys(target, keys, options),
          refreshConversation: async () => {
            const fresh = await fetchConversationDetail(
              conversationId,
              options
            );
            return fresh.conversation;
          },
        });
        if (cancelled) {
          return;
        }
        // The heal may have posted a wrap the cached roots did not include.
        rootKeys.current = null;
        messageDecryptor.clearKeys();
      } catch (error) {
        if (!cancelled) {
          setDetailError(true);
        }
        logWarn("conversation detail failed", {
          reason: error instanceof Error ? error.name : "unknown",
          step: "detail",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    apiOptions,
    conversationId,
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- detailRevision explicitly retries a failed detail request
    detailRevision,
    foreground,
    privateKey,
    userId,
  ]);

  // ---- decryption ------------------------------------------------------------

  const { messages } = transcript.snapshot;

  const decryptItems = useMemo<DecryptItem[]>(
    () =>
      messages.map((message) => ({
        conversationId,
        message: {
          ciphertext: message.ciphertext,
          id: message.id,
          iv: message.iv,
          ratchetIndex: message.ratchetIndex,
          senderId: message.senderId,
        },
      })),
    [conversationId, messages]
  );

  const decrypted = useDecryptedRows(decryptItems, getBaseKeys);

  useEffect(() => {
    if (decryptItems.length > 0) {
      messageDecryptor.request(decryptItems, { getBaseKeys });
    }
  }, [decryptItems, getBaseKeys]);

  // ---- transcript rows -------------------------------------------------------

  const unreadId = useMemo(
    () => unreadBoundaryId(transcript.snapshot, userId ?? ""),
    [transcript.snapshot, userId]
  );

  // Newest-first, because the list is inverted. Dividers become list items so they
  // scroll with the transcript rather than being positioned against it.
  const items = useMemo<TranscriptItem[]>(() => {
    const rows: TranscriptItem[] = [];
    const ordered = reversedCopy(messages);
    for (const [index, message] of ordered.entries()) {
      const forwardIndex = messages.length - 1 - index;
      const group = getMessageGroupMeta(messages, forwardIndex);
      if (index === 0 || group.showTimeDivider) {
        const label = formatTimeDivider(message.createdAt);
        if (label) {
          rows.push({ key: `divider-${message.id}`, kind: "divider", label });
        }
      }
      if (message.id === unreadId) {
        rows.push({ key: `unread-${message.id}`, kind: "unread" });
      }
      rows.push({ key: message.id, kind: "message", message });
    }
    return rows;
  }, [messages, unreadId]);

  const groupMetaFor = useCallback(
    (messageId: string) => {
      const forwardIndex = messages.findIndex((row) => row.id === messageId);
      if (forwardIndex === -1) {
        return SELF_GROUP;
      }
      return getMessageGroupMeta(messages, forwardIndex);
    },
    [messages]
  );

  // ---- send ------------------------------------------------------------------

  const send = useCallback(
    async (payload: MessagePayload) => {
      if (!privateKey || !userId) {
        return;
      }
      const options = await apiOptions();
      const keys = await getBaseKeys(conversationId);
      const [rootKey] = keys;
      if (!rootKey) {
        logWarn("send has no conversation key", { step: "send" });
        // Rethrow rather than toast-and-return. Every other failure in this function
        // propagates, and the composer handles a rejection by keeping the draft
        // and the staged attachments and reporting the error with this message
        // as the description. Returning quietly resolved as success, so the
        // composer cleared the draft the user had typed for nothing.
        throw new Error("Message keys aren't ready yet");
      }
      // The newest epoch is where new messages belong, and the ratchet index counts
      // what this sender has already sent in it.
      const baseIndex = transcriptStore
        .getSnapshot(conversationId)
        .messages.filter((row) => row.senderId === userId).length;

      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          // oxlint-disable-next-line no-await-in-loop -- an ordered retry against the server's own index; the second attempt must not run unless the first 409'd
          const sent = await sendEncryptedMessage(
            conversationId,
            rootKey,
            userId,
            baseIndex + attempt,
            payload,
            options
          );
          transcriptStore.appendMessage(conversationId, sent);
          return;
        } catch (error) {
          if (
            error instanceof MessagesApiError &&
            error.status === 409 &&
            typeof error.expectedIndex === "number"
          ) {
            logWarn("ratchet index retry", { step: "send" });
            continue;
          }
          throw error;
        }
      }
    },
    [apiOptions, conversationId, getBaseKeys, privateKey, userId]
  );

  const handleSend = useCallback(
    async (payload: MessagePayload) => {
      // runWithInstallToken resolves null when the user dismisses the Turnstile
      // gate, so its result is not the send's result: the draft stays in the
      // composer either way, and a real failure has already been logged in `send`.
      await runWithInstallToken(
        async () => {
          await send(payload);
          return true;
        },
        // The send reports nothing for a stale install token, so the answer is
        // whatever the inner call returned: true means it landed.
        () => false
      );
    },
    [runWithInstallToken, send]
  );

  // ---- read / delivered ------------------------------------------------------

  const scheduleRead = useCallback(() => {
    if (readTimer.current) {
      clearTimeout(readTimer.current);
    }
    readTimer.current = setTimeout((): void => {
      const visible = transcriptStore.getSnapshot(conversationId).messages;
      const newestPeerMessage = visible.filter(
        (row) => row.senderId !== userId && !row.deletedAt
      );
      const target = newestPeerMessage.at(-1);
      if (!target) {
        return;
      }
      void (async () => {
        const options = await apiOptions();
        // The read route also advances delivery, so one call covers both marks on
        // OUR row; the explicit ack moves the watermark for what the PEER sent.
        await markConversationRead(conversationId, options).catch(() => {
          /* empty */
        });
        await ackMessageDelivered(conversationId, target.id, options).catch(
          () => {
            /* empty */
          }
        );
        transcriptStore.setMyLastReadAt(
          conversationId,
          new Date().toISOString()
        );
      })();
    }, 400);
  }, [apiOptions, conversationId, userId]);

  useEffect(() => {
    if (messages.length > 0) {
      scheduleRead();
    }
    return () => {
      if (readTimer.current) {
        clearTimeout(readTimer.current);
      }
    };
  }, [messages.length, scheduleRead]);

  // ---- media -----------------------------------------------------------------

  const handleReset = useCallback(async () => {
    await resetIdentity();
  }, [resetIdentity]);

  const openViewer = useCallback(
    (message: MessageData, entry: DecryptEntry | undefined, index: number) => {
      if (
        typeof entry !== "object" ||
        entry === null ||
        entry.type !== "media"
      ) {
        return;
      }
      const images = getMediaImages(entry);
      const apiBase = getApiBaseUrl();
      setViewer({
        images: images.map((image) =>
          image.url.startsWith("http") ? image.url : `${apiBase}${image.url}`
        ),
        index,
      });
      // The sender's client is the only party that can re-assert the conversation
      // link on its own media, since the ids live inside the encrypted payload.
      if (message.senderId === userId) {
        void reclaimOwnMedia(
          images
            .map((image) => image.url.split("/api/media/")[1] ?? "")
            .filter(Boolean),
          conversationId
        );
      }
    },
    [conversationId, userId]
  );

  const retryRow = useCallback(
    (message: MessageData) => {
      messageDecryptor.retry(message.id);
      messageDecryptor.request(
        [
          {
            conversationId,
            message: {
              ciphertext: message.ciphertext,
              id: message.id,
              iv: message.iv,
              ratchetIndex: message.ratchetIndex,
              senderId: message.senderId,
            },
          },
        ],
        { getBaseKeys }
      );
    },
    [conversationId, getBaseKeys]
  );

  const peerPublicKey = peer?.publicKey ?? null;
  const fingerprint = useMemo(() => {
    if (!privateKey || !peerPublicKey) {
      return null;
    }
    return generateFingerprint(
      derivePublicKeyFromPrivate(privateKey),
      peerPublicKey
    );
  }, [privateKey, peerPublicKey]);

  const handleLoadOlder = useCallback(() => {
    transcript.loadOlder();
  }, [transcript]);

  // ---- render ----------------------------------------------------------------

  const renderItem = useCallback(
    ({ item }: { item: TranscriptItem }) => {
      if (item.kind === "divider") {
        return (
          <View style={styles.dividerRow}>
            <Text style={[styles.dividerText, { color: theme.dividerText }]}>
              {item.label}
            </Text>
          </View>
        );
      }
      if (item.kind === "unread") {
        return (
          <View style={styles.unreadRow}>
            <Text style={styles.unreadText}>{UNREAD_DIVIDER_LABEL}</Text>
          </View>
        );
      }
      const { message } = item;
      const mine = message.senderId === userId;
      const entry = decrypted.get(message.id);
      const receipt = getMessageReceipt({
        createdAt: message.createdAt,
        mine,
        watermarks: transcript.snapshot.peerWatermarks,
      });
      return (
        <MessageBubble
          deleted={Boolean(message.deletedAt)}
          edited={Boolean(message.editedAt)}
          failed={entry === "error"}
          group={groupMetaFor(message.id)}
          maxBubbleWidth={MAX_BUBBLE_WIDTH}
          mine={mine}
          onPressImage={(index) => openViewer(message, entry, index)}
          onRetry={() => retryRow(message)}
          payload={isPayload(entry) ? entry : null}
          receipt={receipt}
          showReceipt={groupMetaFor(message.id).isLastInGroup}
          theme={chatTheme}
        />
      );
    },
    [
      chatTheme,
      decrypted,
      groupMetaFor,
      openViewer,
      retryRow,
      theme.dividerText,
      transcript.snapshot.peerWatermarks,
      userId,
    ]
  );

  // Checked here rather than before the hooks above: an early return above them
  // would make the hook count depend on the identity status, which is a real
  // crash the moment a thread re-locks while it is open.
  if (status === "locked") {
    return (
      <MessageIdentityLocked message={identityError} onReset={handleReset} />
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={insets.top}
      style={[styles.root, { backgroundColor: theme.containerBg }]}
    >
      <ThreadHeader
        avatarUrl={peer?.avatarUrl ?? cachedPeer?.avatarUrl ?? null}
        displayName={peer?.displayName ?? cachedPeer?.displayName ?? "Chat"}
        fingerprint={fingerprint}
        onBack={onBack}
        typing={transcript.snapshot.peerTyping}
      />
      {status === "error" || detailError || transcript.snapshot.error ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry loading Messages"
          onPress={() => {
            if (status === "error") {
              retry();
            }
            setDetailRevision((value) => value + 1);
            transcript.refresh();
          }}
          style={{ paddingHorizontal: 16, paddingVertical: 12 }}
        >
          <Text style={{ color: theme.dividerText, fontFamily: "SofiaProReg" }}>
            Couldn't connect to Messages. Tap to retry.
          </Text>
        </Pressable>
      ) : null}
      {transcript.snapshot.loading && messages.length === 0 ? (
        <ThreadSkeleton />
      ) : (
        <FlatList
          contentContainerStyle={styles.listContent}
          data={items}
          inverted
          keyboardDismissMode="interactive"
          keyExtractor={(row) => row.key}
          // Inversion turns "keep loading as the reader scrolls back" into the same
          // endReached the list already knows about, with no scroll-position maths.
          onEndReached={handleLoadOlder}
          onEndReachedThreshold={0.5}
          renderItem={renderItem}
          showsVerticalScrollIndicator={SHOWS_SCROLL_INDICATOR}
        />
      )}
      {transcript.snapshot.peerTyping ? <TypingDots /> : null}
      <MessageComposer
        conversationId={conversationId}
        disabled={status !== "ready"}
        editing={editing}
        onCancelEdit={() => setEditing(null)}
        onCancelReply={() => setReplyTo(null)}
        onSend={handleSend}
        onTyping={() => {
          void (async () => {
            const options = await apiOptions();
            await sendTypingIndicator(conversationId, options);
          })();
        }}
        replyTo={replyTo}
      />
      <MessageMediaViewer
        images={viewer?.images ?? []}
        index={viewer?.index ?? null}
        onClose={() => setViewer(null)}
      />
    </KeyboardAvoidingView>
  );
}

function isPayload(entry: DecryptEntry | undefined): entry is MessagePayload {
  return typeof entry === "object" && entry !== null;
}

// Reads decrypted rows and re-renders when the decryptor flushes, so a bubble
// fills in the instant its plaintext lands rather than on the next list refresh.
function useDecryptedRows(
  items: DecryptItem[],
  getBaseKeys: (conversationId: string) => Promise<Uint8Array[]>
): ReadonlyMap<string, DecryptEntry> {
  const [, bump] = useState(0);
  useEffect(
    () => messageDecryptor.subscribe(() => bump((value) => value + 1)),
    []
  );
  useEffect(() => {
    if (items.length > 0) {
      messageDecryptor.request(items, { getBaseKeys });
    }
  }, [getBaseKeys, items]);
  // NOT memoized on purpose. What changes here is the decryptor's internal state,
  // which no dependency list can name, so a manual memo would hand back a stale map
  // and a landed decrypt would never reach the screen. React Compiler memoizes this
  // on its own; reading the cache on every render is both correct and cheap.
  const map = new Map<string, DecryptEntry>();
  for (const item of items) {
    const entry = messageDecryptor.get(item.message.id);
    if (entry !== undefined) {
      map.set(item.message.id, entry);
    }
  }
  return map;
}

// The header: peer identity, typing state, and the fingerprint two people can
// compare out of band.
function ThreadHeader({
  avatarUrl,
  displayName,
  fingerprint,
  onBack,
  typing,
}: {
  avatarUrl: string | null;
  displayName: string;
  fingerprint: string | null;
  onBack: () => void;
  typing: boolean;
}) {
  const { isDark, theme } = useAppTheme();
  const surface = surface3d(isDark);
  return (
    <View
      style={[
        styles.header,
        {
          backgroundColor: surface.background,
          borderBottomColor: theme.dividerLine,
          boxShadow: surface.shadows,
        },
      ]}
    >
      <MessagesIconButton icon={ArrowLeft} label="Back" onPress={onBack} />
      <UserAvatar size={32} url={avatarUrl} />
      <View style={styles.headerIdentity}>
        <Text
          numberOfLines={1}
          style={[styles.headerName, { color: isDark ? "#eeeeee" : "#202020" }]}
        >
          {displayName}
        </Text>
        {typing ? (
          <Text style={[styles.headerSub, { color: theme.dividerText }]}>
            typing...
          </Text>
        ) : null}
      </View>
      {fingerprint ? (
        <View
          accessibilityLabel={`Safety number ${fingerprint}`}
          style={styles.fingerprint}
        >
          <ShieldCheck color={theme.dividerText} size={13} />
          <Text style={[styles.fingerprintText, { color: theme.dividerText }]}>
            {fingerprint}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function ThreadSkeleton() {
  const { theme } = useAppTheme();
  return (
    <View style={styles.skeleton}>
      {[false, true, false, true].map((mine, index) => (
        <View
          key={index}
          style={[styles.skeletonRow, mine && styles.skeletonRowMine]}
        >
          <View
            style={[
              styles.skeletonBubble,
              { backgroundColor: theme.dividerLine, width: 140 + index * 20 },
            ]}
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  dividerRow: {
    alignItems: "center",
    paddingVertical: 12,
  },
  dividerText: {
    fontFamily: "SofiaProReg",
    fontSize: 11,
  },
  fingerprint: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
  },
  fingerprintText: {
    fontFamily: "SofiaProReg",
    fontSize: 10,
  },
  header: {
    alignItems: "center",
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  headerIdentity: {
    flex: 1,
  },
  headerName: {
    fontFamily: "SofiaProMed",
    fontSize: 15,
  },
  headerSub: {
    fontFamily: "SofiaProReg",
    fontSize: 11,
  },
  listContent: {
    paddingHorizontal: 0,
    paddingTop: 8,
  },
  root: {
    flex: 1,
  },
  skeleton: {
    gap: 14,
    padding: 16,
  },
  skeletonBubble: {
    borderRadius: 16,
    height: 40,
  },
  skeletonRow: {
    alignItems: "flex-start",
  },
  skeletonRowMine: {
    alignItems: "flex-end",
  },
  unreadRow: {
    alignItems: "center",
    paddingVertical: 10,
  },
  unreadText: {
    color: "#ff9500",
    fontFamily: "SofiaProMed",
    fontSize: 11,
  },
});
