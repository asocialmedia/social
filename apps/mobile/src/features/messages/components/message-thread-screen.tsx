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

import * as Clipboard from "expo-clipboard";
import {
  ArrowLeft,
  Copy,
  ListChecks,
  Reply,
  Search,
  ShieldCheck,
  Users,
  X,
} from "lucide-react-native";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  Alert,
  BackHandler,
  Dimensions,
  FlatList,
  useWindowDimensions,
  Keyboard,
  Platform,
  StyleSheet,
  Text,
  View,
  Pressable,
} from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import Animated, { createAnimatedComponent } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { UserAvatar } from "@/components/avatar/user-avatar";
import { authClient } from "@/features/auth/lib/auth-client";
import { useInstall } from "@/features/auth/state/install";
import { useSessionContext } from "@/features/auth/state/session";
import type { ApiCallOptions } from "@/features/feed/lib/feed-api";
import {
  MessagesApiError,
  ackMessageDelivered,
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
import { getMessageGroupMeta } from "@/features/messages/lib/message-grouping";
import { getMessageReceipt } from "@/features/messages/lib/message-receipts";
import { messageReadRetryDelay } from "@/features/messages/lib/read-retry";
import { buildTranscriptRows } from "@/features/messages/lib/transcript-rows";
import type { TranscriptItem } from "@/features/messages/lib/transcript-rows";
import type { MessageData } from "@/features/messages/lib/types";
import { UNREAD_DIVIDER_LABEL } from "@/features/messages/lib/unread-marker";
import { conversationListStore } from "@/features/messages/state/conversation-list-store";
import { useMessagesIdentity } from "@/features/messages/state/message-identity";
import {
  transcriptStore,
  unreadBoundaryId,
} from "@/features/messages/state/transcript-store";
import { unreadMessageStore } from "@/features/messages/state/unread-message-store";
import { useMessageSearch } from "@/features/messages/state/use-message-search";
import { useTranscript } from "@/features/messages/state/use-messages-data";
import { useMessagesForeground } from "@/features/messages/state/use-messages-foreground";
import { getApiBaseUrl } from "@/lib/api-env";
import { haptic } from "@/lib/haptics";
import { keyboardOverlap, keyboardScreenTop } from "@/lib/keyboard-overlap";
import { SHOWS_SCROLL_INDICATOR } from "@/lib/scroll-indicator";
import { logWarn } from "@/lib/telemetry";
import { useAppTheme } from "@/theme";

import { MessageBubble } from "./message-bubble";
import { MessageComposer, reclaimOwnMedia } from "./message-composer";
import type { ComposerTarget } from "./message-composer";
import { MessageIdentityLocked } from "./message-identity-locked";
import { MessageMediaViewer } from "./message-media-viewer";
import { MessagePeoplePanel } from "./message-people-panel";
import { MessageSearchBar } from "./message-search-bar";
import { MessageSearchResults } from "./message-search-results";
import { MessagesIconButton } from "./messages-primitives";
import { SelectableMessageRow } from "./selectable-message-row";
import { TypingDots } from "./typing-dots";
import { useTranscriptGestures } from "./use-transcript-gestures";

// The widest a bubble may be. On web this is a percentage of the transcript; here
// it is a point value the screen passes in, because a phone's width is the thing
// being bounded.

// A row that is no longer in the loaded window (a stale index during a trim)
// renders as a self-contained group rather than throwing.
const AnimatedTranscriptList = createAnimatedComponent(
  FlatList<TranscriptItem>
);

const SELF_GROUP = {
  isFirstInGroup: true,
  isLastInGroup: true,
  showTimeDivider: false,
};

export function MessageThreadScreen({
  conversationId,
  onBack,
}: {
  conversationId: string;
  onBack: () => void;
}) {
  const { theme } = useAppTheme();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const viewportRef = useRef<View>(null);
  const [viewportBottom, setViewportBottom] = useState(
    () => Dimensions.get("window").height
  );
  const [keyboardTop, setKeyboardTop] = useState<number | null>(null);
  const restingBottomInset = useRef(insets.bottom);
  const measureViewport = useCallback(() => {
    viewportRef.current?.measureInWindow((_x, y, _width, height) => {
      setViewportBottom(y + height);
    });
  }, []);
  useEffect(() => {
    if (keyboardTop === null) {
      restingBottomInset.current = insets.bottom;
    }
  }, [insets.bottom, keyboardTop]);
  useEffect(() => {
    const showEvent =
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent =
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const show = Keyboard.addListener(showEvent, (event) => {
      Keyboard.scheduleLayoutAnimation(event);
      setKeyboardTop(
        keyboardScreenTop({
          bottomInset: restingBottomInset.current,
          height: event.endCoordinates.height,
          platform: Platform.OS,
          screenHeight: Dimensions.get("screen").height,
          screenY: event.endCoordinates.screenY,
        })
      );
    });
    const hide = Keyboard.addListener(hideEvent, (event) => {
      Keyboard.scheduleLayoutAnimation(event);
      setKeyboardTop(null);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  const { user } = useSessionContext();
  const { runWithInstallToken } = useInstall();
  const {
    error: identityError,
    getBaseKeys,
    invalidateKeys,
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
  const atLiveEnd = useRef(true);
  const readTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [readyKey, setReadyKey] = useState<typeof privateKey>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [friendsOpen, setFriendsOpen] = useState(false);
  const [keySignature, setKeySignature] = useState("");
  const healedSignature = useRef<string | null>(null);
  const chatTheme = useMemo(
    () => resolveConversationTheme(themeKey),
    [themeKey]
  );

  const foreground = useMessagesForeground();
  const [detailError, setDetailError] = useState(false);
  const [detailRevision, setDetailRevision] = useState(0);
  const detailRetries = useRef(0);
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

  // ---- peer detail + key healing ---------------------------------------------

  useEffect(() => {
    if (!userId || !foreground) {
      return;
    }
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
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
        setKeySignature(
          `${detail.keys.map((key) => `${key.version}:${key.encryptedKey.ciphertext}:${key.encryptedKey.iv}`).join("|")}#${peerMember?.user.messageIdentity?.publicKey ?? ""}`
        );

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
        detailRetries.current = 0;
        invalidateKeys(conversationId);
        messageDecryptor.clearKeys(conversationId);
        messageDecryptor.clearErrors(conversationId);
        setReadyKey(() => privateKey);
      } catch (error) {
        if (!cancelled) {
          setDetailError(true);
          const delay = messageReadRetryDelay(error, detailRetries.current);
          if (delay !== null) {
            detailRetries.current += 1;
            retryTimer = setTimeout(() => {
              setDetailRevision((value) => value + 1);
            }, delay);
          }
        }
        logWarn("conversation detail failed", {
          reason: error instanceof Error ? error.name : "unknown",
          step: "detail",
        });
      }
    })();
    return () => {
      cancelled = true;
      if (retryTimer !== null) {
        clearTimeout(retryTimer);
      }
    };
  }, [
    apiOptions,
    conversationId,
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- detailRevision explicitly retries a failed detail request
    detailRevision,
    foreground,
    invalidateKeys,
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

  const decrypted = useDecryptedRows(
    decryptItems,
    getBaseKeys,
    readyKey === privateKey && status === "ready"
  );

  useEffect(() => {
    if (
      readyKey !== privateKey ||
      status !== "ready" ||
      !foreground ||
      !keySignature
    ) {
      return;
    }
    const heal = () => {
      if (
        messageDecryptor.getErroredIds(conversationId).size === 0 ||
        healedSignature.current === keySignature
      ) {
        return;
      }
      healedSignature.current = keySignature;
      invalidateKeys(conversationId);
      setDetailRevision((value) => value + 1);
    };
    const unsubscribe = messageDecryptor.subscribe(heal);
    heal();
    return unsubscribe;
  }, [
    conversationId,
    foreground,
    invalidateKeys,
    keySignature,
    privateKey,
    readyKey,
    status,
  ]);

  // ---- transcript rows -------------------------------------------------------

  const unreadId = useMemo(
    () => unreadBoundaryId(transcript.snapshot, userId ?? ""),
    [transcript.snapshot, userId]
  );

  // Newest-first, because the list is inverted. Dividers become list items so they
  // scroll with the transcript rather than being positioned against it.
  const items = useMemo(
    () => buildTranscriptRows(messages, unreadId),
    [messages, unreadId]
  );

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
      if (!atLiveEnd.current) {
        return;
      }
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
        try {
          await markConversationRead(conversationId, options);
          transcriptStore.setMyLastReadAt(
            conversationId,
            new Date().toISOString()
          );
          unreadMessageStore.notifyActivity();
        } catch {
          // Keep the unread state until the server accepts the read watermark.
        }
        await ackMessageDelivered(conversationId, target.id, options).catch(
          () => {
            // Delivery retries on a later foreground reconciliation.
          }
        );
      })();
    }, 400);
  }, [apiOptions, conversationId, userId]);

  useEffect(() => {
    if (messages.length > 0 && foreground && !searchOpen) {
      scheduleRead();
    }
    return () => {
      if (readTimer.current) {
        clearTimeout(readTimer.current);
      }
    };
  }, [foreground, messages.length, scheduleRead, searchOpen]);

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

  const handleReply = useCallback(
    (id: string) => {
      const message = transcriptStore
        .getSnapshot(conversationId)
        .messages.find((row) => row.id === id);
      const payload = messageDecryptor.get(id);
      if (!message || message.deletedAt || !isPayload(payload)) {
        return;
      }
      setEditing(null);
      setReplyTo({
        id,
        senderId: message.senderId,
        text: messageSummary(payload),
      });
      haptic();
    },
    [conversationId]
  );
  const onLiveEndChange = useCallback(
    (atLatest: boolean) => {
      if (atLatest && !atLiveEnd.current && foreground && !searchOpen) {
        scheduleRead();
      }
      atLiveEnd.current = atLatest;
    },
    [foreground, scheduleRead, searchOpen]
  );
  const {
    CellRenderer,
    clearSelection,
    gesture,
    listRef: threadListRef,
    handleViewportLayout,
    nativeScroll,
    handleContentSizeChange,
    handleScroll,
    handleSelectAll,
    selectedIds,
    swipeId,
    swipeX,
    toggleSelected,
    viewportRef: transcriptViewportRef,
  } = useTranscriptGestures({
    messages,
    onLiveEndChange,
    onReply: handleReply,
  });
  const selectionActive = selectedIds.size > 0;
  useEffect(() => {
    if (!selectionActive) {
      return;
    }
    const listener = BackHandler.addEventListener("hardwareBackPress", () => {
      clearSelection();
      return true;
    });
    return () => listener.remove();
  }, [clearSelection, selectionActive]);
  const copySelected = useCallback(() => {
    const text = messages
      .filter((message) => selectedIds.has(message.id) && !message.deletedAt)
      .map((message) => messageDecryptor.get(message.id))
      .filter(isPayload)
      .map(messageSummary)
      .join("\n");
    if (text) {
      void Clipboard.setStringAsync(text);
      haptic();
    }
  }, [messages, selectedIds]);
  const scrollToSearchIndex = useCallback(
    (index: number) => {
      threadListRef.current?.scrollToIndex({
        animated: false,
        index,
        viewPosition: 0.5,
      });
    },
    [threadListRef]
  );
  const scrollToSearchOffset = useCallback(
    (offset: number) => {
      threadListRef.current?.scrollToOffset({ animated: false, offset });
    },
    [threadListRef]
  );
  const search = useMessageSearch({
    decrypted,
    foreground,
    hasMoreOlder: transcript.snapshot.hasMoreOlder,
    historyError: transcript.snapshot.error,
    items,
    loadOlder: transcript.loadOlder,
    loadingOlder: transcript.snapshot.loadingOlder,
    messages,
    onClose: () => setSearchOpen(false),
    open: searchOpen,
    scope: userId ? `${userId}:${conversationId}` : null,
    scrollToIndex: scrollToSearchIndex,
    scrollToOffset: scrollToSearchOffset,
  });

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
      const replyId = isPayload(entry) ? entry.replyToId : undefined;
      const quoted = replyId ? decrypted.get(replyId) : undefined;
      const quotedMessage = replyId
        ? messages.find((row) => row.id === replyId)
        : undefined;
      let quoteText = "Message";
      if (quotedMessage?.deletedAt) {
        quoteText = "Message deleted";
      } else if (isPayload(quoted)) {
        quoteText = messageSummary(quoted);
      }
      const receipt = getMessageReceipt({
        createdAt: message.createdAt,
        mine,
        watermarks: transcript.snapshot.peerWatermarks,
      });
      return (
        <SelectableMessageRow
          id={message.id}
          selected={selectedIds.has(message.id)}
          selectionActive={selectionActive}
          onToggle={toggleSelected}
          swipeId={swipeId}
          swipeX={swipeX}
        >
          <MessageBubble
            searchJump={search.activeId === message.id ? search.jump : 0}
            deleted={Boolean(message.deletedAt)}
            edited={Boolean(message.editedAt)}
            failed={entry === "error"}
            group={groupMetaFor(message.id)}
            maxBubbleWidth={width - 32}
            mine={mine}
            onPressImage={(index) =>
              selectionActive
                ? toggleSelected(message.id)
                : openViewer(message, entry, index)
            }
            onRetry={() => retryRow(message)}
            payload={isPayload(entry) ? entry : null}
            peerAvatarUrl={peer?.avatarUrl ?? cachedPeer?.avatarUrl ?? null}
            receipt={receipt}
            replyPreview={
              replyId
                ? {
                    senderId: quotedMessage?.senderId ?? "",
                    text: quoteText,
                  }
                : null
            }
            showReceipt={groupMetaFor(message.id).isLastInGroup}
            theme={chatTheme}
          />
        </SelectableMessageRow>
      );
    },
    [
      search.activeId,
      search.jump,
      chatTheme,
      cachedPeer?.avatarUrl,
      peer?.avatarUrl,
      width,
      decrypted,
      groupMetaFor,
      openViewer,
      retryRow,
      theme.dividerText,
      transcript.snapshot.peerWatermarks,
      userId,
      selectedIds,
      selectionActive,
      toggleSelected,
      swipeId,
      swipeX,
      messages,
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
    <View
      ref={viewportRef}
      onLayout={measureViewport}
      style={[
        styles.root,
        {
          backgroundColor: theme.containerBg,
          paddingBottom: keyboardOverlap(viewportBottom, keyboardTop),
          paddingLeft: insets.left,
          paddingRight: insets.right,
          paddingTop: insets.top,
        },
      ]}
    >
      {selectionActive ? (
        <View style={[styles.header, { borderBottomColor: theme.dividerLine }]}>
          <MessagesIconButton
            icon={X}
            label="Cancel selection"
            onPress={clearSelection}
            size={32}
          />
          <Text
            style={[
              styles.headerName,
              styles.selectionCount,
              { color: theme.dividerText },
            ]}
          >
            {selectedIds.size} selected
          </Text>
          {selectedIds.size === 1 ? (
            <MessagesIconButton
              icon={Reply}
              label="Reply to selected message"
              onPress={() => {
                const [id] = selectedIds;
                clearSelection();
                if (id) {
                  handleReply(id);
                }
              }}
              size={32}
            />
          ) : null}
          <MessagesIconButton
            icon={Copy}
            label="Copy selected messages"
            onPress={copySelected}
            size={32}
          />
          <MessagesIconButton
            icon={ListChecks}
            label="Select all loaded messages"
            onPress={handleSelectAll}
            size={32}
          />
        </View>
      ) : (
        <ThreadHeader
          avatarUrl={peer?.avatarUrl ?? cachedPeer?.avatarUrl ?? null}
          displayName={peer?.displayName ?? cachedPeer?.displayName ?? "Chat"}
          fingerprint={fingerprint}
          onBack={onBack}
          onSearch={() => {
            if (searchOpen) {
              search.handleClose();
            } else {
              setSearchOpen(true);
            }
          }}
          onFriends={() => setFriendsOpen((open) => !open)}
          username={cachedPeer?.peerUsername ?? null}
          typing={transcript.snapshot.peerTyping}
        />
      )}
      {friendsOpen ? (
        <MessagePeoplePanel
          mode="online"
          onClose={() => setFriendsOpen(false)}
        />
      ) : null}
      {searchOpen ? (
        <MessageSearchBar
          query={search.query}
          onQueryChange={(value) => search.setQuery(value)}
          listView={search.listView}
          onToggleView={() => search.setListView((value) => !value)}
          onClose={search.handleClose}
          onStep={search.handleStep}
          onPage={(direction) =>
            search.setRequestedPage(search.page.page + direction)
          }
          onIndexOlder={search.handleIndexOlder}
          indexingOlder={search.indexingOlder}
          indexedCount={search.indexedCount}
          fullyCovered={search.fullyCovered}
          canIndexOlder={search.canIndexOlder}
          error={search.error}
          matchCount={search.matchCount}
          activePosition={search.activePosition}
          page={search.page}
        />
      ) : null}
      {status === "error" ||
      (detailError && !peer && !cachedPeer) ||
      (transcript.snapshot.error && !transcript.snapshot.initialLoaded) ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry loading Messages"
          onPress={() => {
            if (status === "error") {
              retry();
            }
            detailRetries.current = 0;
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
      <View
        ref={transcriptViewportRef}
        onLayout={handleViewportLayout}
        style={{ flex: 1 }}
      >
        {transcript.snapshot.loading && messages.length === 0 ? (
          <ThreadSkeleton />
        ) : (
          <GestureDetector gesture={gesture}>
            <Animated.View style={{ flex: 1 }}>
              <GestureDetector gesture={nativeScroll}>
                <AnimatedTranscriptList
                  contentContainerStyle={styles.listContent}
                  ref={threadListRef}
                  data={items}
                  onScrollToIndexFailed={search.handleScrollToIndexFailed}
                  style={{ flex: 1 }}
                  inverted
                  CellRendererComponent={CellRenderer}
                  extraData={selectedIds}
                  onContentSizeChange={handleContentSizeChange}
                  scrollEventThrottle={16}
                  onScroll={handleScroll}
                  keyboardDismissMode="interactive"
                  keyExtractor={(row) => row.key}
                  // Inversion turns "keep loading as the reader scrolls back" into the same
                  // endReached the list already knows about, with no scroll-position maths.
                  onEndReached={searchOpen ? undefined : handleLoadOlder}
                  onEndReachedThreshold={0.5}
                  renderItem={renderItem}
                  showsVerticalScrollIndicator={SHOWS_SCROLL_INDICATOR}
                />
              </GestureDetector>
            </Animated.View>
          </GestureDetector>
        )}
        {searchOpen && search.listView ? (
          <MessageSearchResults
            results={search.page.pageResults}
            messages={messages}
            activeId={search.activeId}
            userId={userId}
            peerName={peer?.displayName ?? cachedPeer?.displayName ?? "them"}
            onJump={search.handleJumpTo}
            emptyLabel={search.emptyLabel}
          />
        ) : null}
      </View>
      {transcript.snapshot.peerTyping ? <TypingDots /> : null}
      <MessageComposer
        conversationId={conversationId}
        peerName={peer?.displayName ?? cachedPeer?.displayName ?? ""}
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
      {viewer ? (
        <MessageMediaViewer
          images={viewer.images}
          index={viewer.index}
          onClose={() => setViewer(null)}
        />
      ) : null}
    </View>
  );
}

function isPayload(entry: DecryptEntry | undefined): entry is MessagePayload {
  return typeof entry === "object" && entry !== null;
}

function messageSummary(payload: MessagePayload): string {
  if (payload.content?.trim()) {
    return payload.content;
  }
  if (payload.type === "media") {
    return payload.kind === "gif" ? "GIF" : "Photo";
  }
  return "Shared a post";
}

// Reads decrypted rows and re-renders when the decryptor flushes, so a bubble
// fills in the instant its plaintext lands rather than on the next list refresh.
function useDecryptedRows(
  items: DecryptItem[],
  getBaseKeys: (conversationId: string) => Promise<Uint8Array[]>,
  ready: boolean
): ReadonlyMap<string, DecryptEntry> {
  const version = useSyncExternalStore(
    messageDecryptor.subscribe,
    messageDecryptor.getVersion
  );
  useEffect(() => {
    if (ready && items.length > 0) {
      messageDecryptor.request(items, { getBaseKeys });
    }
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- an external cache invalidation requeues unrequested rows
  }, [getBaseKeys, items, ready, version]);
  return readDecryptedRows(items, version);
}

// Passing the version prevents the compiler from caching reads of this singleton.
function readDecryptedRows(
  items: DecryptItem[],
  _version: number
): ReadonlyMap<string, DecryptEntry> {
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
  onSearch,
  onFriends,
  username,
  typing,
}: {
  avatarUrl: string | null;
  displayName: string;
  fingerprint: string | null;
  onBack: () => void;
  onSearch: () => void;
  onFriends: () => void;
  username: string | null;
  typing: boolean;
}) {
  const { isDark, theme } = useAppTheme();
  return (
    <View
      style={[
        styles.header,
        {
          backgroundColor: theme.containerBg,
          borderBottomColor: theme.dividerLine,
        },
      ]}
    >
      <MessagesIconButton
        icon={ArrowLeft}
        label="Back"
        onPress={onBack}
        size={32}
      />
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
        ) : (
          <Text
            numberOfLines={1}
            style={[styles.headerSub, { color: theme.dividerText }]}
          >
            {username ? `@${username}` : ""}
          </Text>
        )}
      </View>
      {fingerprint ? (
        <MessagesIconButton
          icon={ShieldCheck}
          label="Safety number"
          size={32}
          onPress={() =>
            Alert.alert(
              "Safety number",
              `${fingerprint}\n\nMessages are encrypted in transit and at rest. Your account automatically recovers its keys on new devices.`
            )
          }
        />
      ) : null}
      <MessagesIconButton
        icon={Search}
        label="Search in conversation"
        onPress={onSearch}
        size={32}
      />
      <MessagesIconButton
        icon={Users}
        label="Online friends"
        onPress={onFriends}
        size={32}
      />
      <MessagesIconButton
        icon={X}
        label="Close chat"
        onPress={onBack}
        size={32}
      />
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
    gap: 8,
    height: 56,
    paddingHorizontal: 12,
  },
  headerIdentity: {
    flex: 1,
  },
  headerName: {
    fontFamily: "SofiaProMed",
    fontSize: 14,
  },
  headerSub: {
    fontFamily: "SofiaProReg",
    fontSize: 12,
  },
  listContent: {
    paddingHorizontal: 0,
    paddingTop: 8,
  },
  root: {
    flex: 1,
  },
  selectionCount: {
    flex: 1,
  },
  skeleton: {
    flex: 1,
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
