import { messageIsRetained } from "@asm/messages";
import * as Clipboard from "expo-clipboard";
import { Image } from "expo-image";
import {
  ArrowLeft,
  Copy,
  ListChecks,
  MoreHorizontal,
  Reply,
  Search,
  Shield,
  Smile,
  Trash2,
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
import type { ViewInstance } from "react-native";
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

import chatDoodle from "@/assets/images/chat-doodle.webp";
import { UserAvatar } from "@/components/avatar/user-avatar";
import { toast } from "@/components/feedback/toast";
import { authClient } from "@/features/auth/lib/auth-client";
import { useInstall } from "@/features/auth/state/install";
import { useSessionContext } from "@/features/auth/state/session";
import type { ApiCallOptions } from "@/features/feed/lib/feed-api";
import { UserBadge } from "@/features/home/components/user-badge";
import {
  ackMessageDelivered,
  createConversation,
  deleteMessage,
  editMessage,
  ensureConversationKeys,
  fetchConversationDetail,
  hideMessages,
  markConversationRead,
  reencryptMessageForEdit,
  toggleMessageReaction,
  postConversationKeys,
  sendEncryptedMessage,
  sendTypingIndicator,
} from "@/features/messages/lib/client";
import type { ConversationPrefs } from "@/features/messages/lib/client";
import {
  buildViewerMediaItems,
  viewerAnchorIndex,
} from "@/features/messages/lib/conversation-media";
import {
  conversationKind,
  conversationLeft,
  conversationName,
} from "@/features/messages/lib/conversation-presentation";
import { resolveConversationTheme } from "@/features/messages/lib/conversation-theme";
import {
  decryptMessage,
  editMessagePayload,
  getMediaImages,
} from "@/features/messages/lib/crypto";
import type { MessagePayload } from "@/features/messages/lib/crypto";
import { messageDecryptor } from "@/features/messages/lib/decryptor";
import type {
  DecryptEntry,
  DecryptItem,
} from "@/features/messages/lib/decryptor";
import { detailsPlacement } from "@/features/messages/lib/details-placement";
import {
  canDeleteForEveryone,
  canEditMessage,
  chunkMessageIds,
  messageDeleteCopy,
  pendingDeleteCount,
} from "@/features/messages/lib/message-delete";
import type { PendingMessageDelete } from "@/features/messages/lib/message-delete";
import { getMessageGroupMeta } from "@/features/messages/lib/message-grouping";
import { getMessageReceipt } from "@/features/messages/lib/message-receipts";
import { messageReadRetryDelay } from "@/features/messages/lib/read-retry";
import { buildTranscriptRows } from "@/features/messages/lib/transcript-rows";
import type { TranscriptItem } from "@/features/messages/lib/transcript-rows";
import type {
  MessageConversationData,
  MessageData,
  MessageSender,
} from "@/features/messages/lib/types";
import { UNREAD_DIVIDER_LABEL } from "@/features/messages/lib/unread-marker";
import {
  closeViewOnceMedia,
  openViewOnceMedia,
} from "@/features/messages/lib/view-once-client";
import { conversationListStore } from "@/features/messages/state/conversation-list-store";
import { useMessagesIdentity } from "@/features/messages/state/message-identity";
import {
  transcriptStore,
  unreadBoundaryId,
} from "@/features/messages/state/transcript-store";
import { unreadMessageStore } from "@/features/messages/state/unread-message-store";
import { useMessagePresence } from "@/features/messages/state/use-message-presence";
import { useMessageSearch } from "@/features/messages/state/use-message-search";
import { useTranscript } from "@/features/messages/state/use-messages-data";
import { useMessagesForeground } from "@/features/messages/state/use-messages-foreground";
import { haptic } from "@/lib/interaction/haptics";
import {
  keyboardOverlap,
  keyboardScreenTop,
} from "@/lib/layout/keyboard-overlap";
import { LIST_VIRTUALIZATION_PROPS } from "@/lib/layout/list-virtualization";
import { SHOWS_SCROLL_INDICATOR } from "@/lib/layout/scroll-indicator";
import { logWarn } from "@/lib/lifecycle/telemetry";
import { getApiBaseUrl } from "@/lib/network/api-env";
import { AppThemeOverride, useAppTheme } from "@/theme";

import { NativeChatLifecycleBoundary } from "./chat-lifecycle-context";
import { useNativeChatLifecycle } from "./chat-lifecycle-state";
import { ChatModeTransition } from "./chat-mode-transition";
import { ConversationDetails } from "./conversation-details";
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
import { ConversationGreeting } from "./conversation-greeting";
import { DenAvatar } from "./den-avatar";
import { NativeIncognitoThread } from "./incognito-thread";
import { NativeIncognitoUsageNotice } from "./incognito-usage-notice";
import { MessageBubble } from "./message-bubble";
import { MessageComposer, reclaimOwnMedia } from "./message-composer";
import type { ComposerTarget } from "./message-composer";
import { MessageDeleteDialog } from "./message-delete-dialog";
import { MessageIdentityLocked } from "./message-identity-locked";
import { MessageMediaViewer } from "./message-media-viewer";
import { MessageOptionsSheet } from "./message-options-sheet";
import { MessagePresenceIndicator } from "./message-presence-indicator";
import { MessageReactionSheet } from "./message-reaction-sheet";
import { MessageSearchBar } from "./message-search-bar";
import { MessageSearchResults } from "./message-search-results";
import { MessageSharePicker } from "./message-share-picker";
import { MessageSheet } from "./message-sheet";
import { MessagesIconButton } from "./messages-primitives";
import { ThreadSkeleton } from "./messages-skeleton";
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

export function MessageThreadScreen(props: {
  conversationId: string;
  onBack: () => void;
  requestedMessageId?: string;
}) {
  return (
    <NativeChatLifecycleBoundary
      key={props.conversationId}
      conversationId={props.conversationId}
      onBack={props.onBack}
    >
      <NormalMessageThreadScreen {...props} />
    </NativeChatLifecycleBoundary>
  );
}

function NormalMessageThreadScreen({
  conversationId,
  onBack,
  requestedMessageId,
}: {
  conversationId: string;
  onBack: () => void;
  requestedMessageId?: string;
}) {
  const {
    snapshot: lifecycle,
    options: lifecycleOptions,
    fresh: incognitoFresh,
    revision: lifecycleRevision,
    contentRevision,
    serverOffset,
    refresh: refreshLifecycle,
    busy: lifecycleBusy,
    error: lifecycleError,
  } = useNativeChatLifecycle();
  const activeIncognito =
    lifecycle?.activeSession?.endedAt === null ? lifecycle.activeSession : null;
  const { theme } = useAppTheme();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const viewportRef = useRef<ViewInstance>(null);
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
    identity,
    mediaCookie,
    getBaseKeys,
    invalidateKeys,
    privateKey,
    reset: resetIdentity,
    retry,
    status,
  } = useMessagesIdentity();
  const userId = user?.id ?? null;
  const transcript = useTranscript(conversationId, !activeIncognito);
  const presence = useMessagePresence();

  const [peer, setPeer] = useState<
    | ({
        avatarUrl: string | null;
        displayName: string;
        id: string | null;
        username: string | null;
      } & Pick<MessageSender, "badge" | "badges" | "communityMemberships">)
    | null
  >(null);
  const [themeKey, setThemeKey] = useState<string | null>(null);
  const [conversation, setConversation] =
    useState<MessageConversationData | null>(null);
  const [prefs, setPrefs] = useState<ConversationPrefs>({
    mutedAt: null,
    themeKey: null,
  });
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [reactionTarget, setReactionTarget] = useState<string | null>(null);
  // The per-message options sheet (web's message-options-menu) and the delete
  // confirm (web's MessageDeleteDialog). `pendingDelete` mirrors web's union:
  // bulk ids for "for me", one message for "for everyone".
  const [optionsMessageId, setOptionsMessageId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] =
    useState<PendingMessageDelete | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  // The message being forwarded into another conversation through the share
  // picker (the options sheet's Forward row).
  const [forwardMessageId, setForwardMessageId] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<ComposerTarget | null>(null);
  const [reactionPendingIds, setReactionPendingIds] = useState<
    ReadonlySet<string>
  >(new Set());
  const reactionLocks = useRef(new Set<string>());
  const [editing, setEditing] = useState<ComposerTarget | null>(null);
  const [viewer, setViewer] = useState<{
    images: string[];
    index: number;
  } | null>(null);
  const atLiveEnd = useRef(true);
  const readTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [readyKey, setReadyKey] = useState<typeof privateKey>(null);
  const [searchOpen, setSearchOpen] = useState(false);
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
  const cachedPeerUser = cachedPeer?.conversation.members.find(
    (member) => member.userId === cachedPeer.peerId
  )?.user;

  const apiOptions = useCallback(async (): Promise<ApiCallOptions> => {
    const cookie = await authClient.getCookie();
    return {
      apiBase: getApiBaseUrl(),
      baseFetch: fetch,
      cookie: cookie ?? undefined,
    };
  }, []);
  const openViewOnce = useCallback(
    async (mediaId: string, grantId: string, signal?: AbortSignal) =>
      openViewOnceMedia(
        conversationId,
        mediaId,
        grantId,
        await apiOptions(),
        signal
      ),
    [apiOptions, conversationId]
  );
  const closeViewOnce = useCallback(
    async (mediaId: string, grantId: string) =>
      closeViewOnceMedia(conversationId, mediaId, grantId, await apiOptions()),
    [apiOptions, conversationId]
  );

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
        setConversation(detail.conversation);
        setPrefs(detail.prefs);
        setPeer({
          avatarUrl: peerMember?.user.avatarUrl ?? null,
          badge: peerMember?.user.badge ?? null,
          badges: peerMember?.user.badges ?? [],
          communityMemberships: peerMember?.user.communityMemberships ?? [],
          displayName:
            peerMember?.user.displayName || peerMember?.user.username || "Chat",
          id: peerMember?.userId ?? null,
          username: peerMember?.user.username ?? null,
        });
        setThemeKey(detail.prefs.themeKey ?? mine?.themeKey ?? null);
        setKeySignature(
          `${detail.keys.map((key) => `${key.version}:${key.wrapperPublicKey ?? ""}:${key.wrapperUserId ?? ""}:${key.encryptedKey.ciphertext}:${key.encryptedKey.iv}`).join("|")}#${peerMember?.user.messageIdentity?.publicKey ?? ""}`
        );

        if (transcript.detailRevision < 0) {
          return;
        }
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
    transcript.detailRevision,
    foreground,
    invalidateKeys,
    privateKey,
    userId,
  ]);

  // ---- decryption ------------------------------------------------------------

  const retainedRows = transcript.snapshot.messages;
  const [expiryClock, setExpiryClock] = useState(Date.now);
  const messages = useMemo(
    () =>
      retainedRows.filter((message) => messageIsRetained(message, expiryClock)),
    [retainedRows, expiryClock]
  );
  useEffect(() => {
    const deadlines = retainedRows.flatMap((message) =>
      message.expiresAt ? [new Date(message.expiresAt).getTime()] : []
    );
    if (!deadlines.length) {
      return;
    }
    const timer = setTimeout(
      () => {
        const now = Date.now();
        transcriptStore.removeMessages(
          conversationId,
          new Set(
            retainedRows
              .filter((message) => !messageIsRetained(message, now))
              .map((message) => message.id)
          )
        );
        setExpiryClock(now);
      },
      Math.max(0, Math.min(...deadlines) - Date.now()) + 10
    );
    return () => clearTimeout(timer);
  }, [retainedRows, conversationId]);

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
    () => buildTranscriptRows(messages, unreadId, lifecycle?.notices),
    [messages, unreadId, lifecycle?.notices]
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
        throw new Error("Message keys aren’t ready yet. Please retry shortly.");
      }
      const options = await apiOptions();
      const detail = await fetchConversationDetail(conversationId, options);
      const rootKey = await ensureConversationKeys(
        detail.conversation,
        privateKey,
        userId,
        {
          postKeys: (target, keys) =>
            postConversationKeys(target, keys, options),
          refreshConversation: async () => {
            const fresh = await fetchConversationDetail(
              conversationId,
              options
            );
            return fresh.conversation;
          },
        }
      );
      invalidateKeys(conversationId);
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
      let baseIndex = 0;
      for (const row of transcriptStore.getSnapshot(conversationId).messages) {
        if (row.senderId === userId) {
          baseIndex = Math.max(baseIndex, row.ratchetIndex + 1);
        }
      }
      const sent = await sendEncryptedMessage(
        conversationId,
        rootKey,
        userId,
        baseIndex,
        payload,
        options
      );
      transcriptStore.appendMessage(conversationId, sent);
    },
    [apiOptions, conversationId, invalidateKeys, privateKey, userId]
  );

  const handleSend = useCallback(
    async (payload: MessagePayload) => {
      const acknowledged = await runWithInstallToken(
        async () => {
          await send(payload);
          return true;
        },
        () => false
      );
      if (!acknowledged) {
        throw new Error("Message wasn’t sent. Your draft has been kept.");
      }
    },
    [runWithInstallToken, send]
  );

  // ---- read / delivered ------------------------------------------------------

  const scheduleRead = useCallback(() => {
    if (activeIncognito) {
      return;
    }
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
          // Reconcile safely on the next request; do not expose source errors.
          // Keep the unread state until the server accepts the read watermark.
        }
        await ackMessageDelivered(conversationId, target.id, options).catch(
          () => {
            // Delivery retries on a later foreground reconciliation.
          }
        );
      })();
    }, 400);
  }, [apiOptions, conversationId, userId, activeIncognito]);

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
      const apiBase = getApiBaseUrl();
      // The fullscreen viewer walks every photo in the loaded transcript, not
      // just the tapped album, like web's conversation media index.
      const viewerItems = buildViewerMediaItems(
        messages,
        (id) => decrypted.get(id),
        apiBase
      );
      if (viewerItems.length > 0) {
        setViewer({
          images: viewerItems.map((viewerItem) => viewerItem.url),
          index: viewerAnchorIndex(viewerItems, message.id, index),
        });
      } else {
        const images = getMediaImages(entry);
        if (images.length === 0) {
          return;
        }
        setViewer({
          images: images.map((image) =>
            image.url.startsWith("http") ? image.url : `${apiBase}${image.url}`
          ),
          index,
        });
      }
      // The sender's client is the only party that can re-assert the conversation
      // link on its own media, since the ids live inside the encrypted payload.
      if (message.senderId === userId) {
        const images = getMediaImages(entry);
        void reclaimOwnMedia(
          images
            .map((image) => image.url.split("/api/media/")[1] ?? "")
            .filter(Boolean),
          conversationId
        );
      }
    },
    [conversationId, decrypted, messages, userId]
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
  const handleMessageReaction = useCallback(
    async (messageId: string, emoji: string) => {
      if (reactionLocks.current.has(messageId)) {
        return;
      }
      reactionLocks.current.add(messageId);
      setReactionPendingIds((current) => new Set(current).add(messageId));
      try {
        const options = await apiOptions();
        const reactions = await toggleMessageReaction(
          conversationId,
          messageId,
          emoji,
          options
        );
        transcriptStore.applyMessageReactions(
          conversationId,
          messageId,
          reactions
        );
        haptic();
      } catch (error) {
        toast({
          description:
            error instanceof Error
              ? error.message
              : "Couldn't update reaction.",
          title: "Reaction failed",
          variant: "destructive",
        });
      }
      reactionLocks.current.delete(messageId);
      setReactionPendingIds((current) => {
        const next = new Set(current);
        next.delete(messageId);
        return next;
      });
    },
    [apiOptions, conversationId]
  );
  const handleDefaultReaction = useCallback(
    (messageId: string) => {
      void handleMessageReaction(messageId, "❤️");
    },
    [handleMessageReaction]
  );

  // ---- message options + delete --------------------------------------------

  const requestDeleteForMe = useCallback((message: MessageData) => {
    setPendingDelete({ messageIds: [message.id], scope: "for-me" });
    setOptionsMessageId(null);
    setDeleteOpen(true);
  }, []);

  const requestDeleteForEveryone = useCallback((message: MessageData) => {
    setPendingDelete({ message: { id: message.id }, scope: "for-everyone" });
    setOptionsMessageId(null);
    setDeleteOpen(true);
  }, []);

  const confirmPendingDelete = useCallback(async () => {
    if (!pendingDelete || deleteBusy) {
      return;
    }
    setDeleteBusy(true);
    try {
      const options = await apiOptions();
      if (pendingDelete.scope === "for-everyone") {
        // Optimistic retract: mark the row deleted, then confirm with the
        // server. A failure reloads the window so the row comes back.
        transcriptStore.applyMessageDeleted(
          conversationId,
          pendingDelete.message.id,
          new Date()
        );
        await deleteMessage(pendingDelete.message.id, options);
      } else {
        // Optimistic hide: rows leave the transcript, then the hides post in
        // request-sized chunks. A failure reloads the window to restore them.
        const ids = new Set(pendingDelete.messageIds);
        transcriptStore.removeMessages(conversationId, ids);
        const chunks = chunkMessageIds(pendingDelete.messageIds);
        await Promise.all(
          chunks.map((chunk) =>
            hideMessages(conversationId, [...chunk], options)
          )
        );
      }
      setPendingDelete(null);
      setDeleteOpen(false);
      setDeleteBusy(false);
    } catch (error) {
      toast({
        description:
          error instanceof Error ? error.message : "Couldn't delete message",
        title: "Message not deleted",
        variant: "destructive",
      });
      transcript.loadNewest();
      setDeleteBusy(false);
    }
  }, [apiOptions, conversationId, deleteBusy, pendingDelete, transcript]);

  const copyMessage = useCallback(
    (messageId: string) => {
      const message = transcriptStore
        .getSnapshot(conversationId)
        .messages.find((row) => row.id === messageId);
      const payload = messageDecryptor.get(messageId);
      if (!message || message.deletedAt || !isPayload(payload)) {
        return;
      }
      void Clipboard.setStringAsync(messageSummary(payload));
      haptic();
    },
    [conversationId]
  );

  const handleSaveEdit = useCallback(
    async (text: string) => {
      if (!editing || !privateKey || !userId) {
        throw new Error("Message keys aren’t ready yet. Please retry shortly.");
      }
      const options = await apiOptions();
      const rootKeys = await getBaseKeys(conversationId);
      const [firstRoot] = rootKeys;
      if (!firstRoot) {
        throw new Error("Message keys aren't ready yet");
      }
      const current = transcriptStore
        .getSnapshot(conversationId)
        .messages.find((row) => row.id === editing.id);
      if (!current || current.deletedAt) {
        throw new Error("This message is no longer available.");
      }
      const cached = messageDecryptor.get(editing.id);
      const payload = isPayload(cached)
        ? cached
        : await decryptMessage(firstRoot, userId, conversationId, {
            ciphertext: current.ciphertext,
            iv: current.iv,
            ratchetIndex: current.ratchetIndex,
          });
      const reencrypted = await reencryptMessageForEdit({
        conversationId,
        current: {
          ciphertext: current.ciphertext,
          iv: current.iv,
          ratchetIndex: current.ratchetIndex,
        },
        editedPayload: editMessagePayload(payload, text),
        rootKeys,
        senderId: userId,
      });
      if (!reencrypted) {
        throw new Error("Message keys aren't ready yet");
      }
      const updated = await editMessage(
        editing.id,
        { ciphertext: reencrypted.ciphertext, iv: reencrypted.iv },
        options
      );
      transcriptStore.applyMessageEdit(conversationId, updated);
      messageDecryptor.retry(updated.id);
    },
    [apiOptions, conversationId, editing, getBaseKeys, privateKey, userId]
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
    onReact: handleDefaultReaction,
    onReply: handleReply,
  });
  const selectionActive = selectedIds.size > 0;
  useEffect(() => {
    if (!selectionActive || activeIncognito) {
      return;
    }
    const listener = BackHandler.addEventListener("hardwareBackPress", () => {
      clearSelection();
      return true;
    });
    return () => listener.remove();
  }, [clearSelection, selectionActive, activeIncognito]);
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

  // The message behind the options sheet, resolved from the loaded window.
  const optionsMessage = useMemo(
    () =>
      optionsMessageId
        ? (messages.find((row) => row.id === optionsMessageId) ?? null)
        : null,
    [messages, optionsMessageId]
  );

  // Selection-scoped actions live here, after the gestures hook declares
  // `selectedIds` and `clearSelection`, so no callback reads them during init.
  const requestDeleteSelectedForMe = useCallback(() => {
    const ids = [...selectedIds];
    if (ids.length === 0) {
      return;
    }
    clearSelection();
    setOptionsMessageId(null);
    setPendingDelete({ messageIds: ids, scope: "for-me" });
    setDeleteOpen(true);
  }, [clearSelection, selectedIds]);

  const handleEditMessage = useCallback(
    (message: MessageData) => {
      const payload = messageDecryptor.get(message.id);
      setOptionsMessageId(null);
      clearSelection();
      setReplyTo(null);
      setEditing({
        id: message.id,
        senderId: message.senderId,
        text: isPayload(payload) ? messageSummary(payload) : "",
      });
    },
    [clearSelection]
  );

  // Forwards the decrypted payload into another conversation, re-wrapped for
  // its members. Only text and post cards forward; media stays put rather
  // than re-uploading bytes the peer already stores under another link.
  const forwardToConversation = useCallback(
    async (recipientId: string, caption: string) => {
      if (!forwardMessageId || !privateKey || !userId) {
        throw new Error("Message keys aren’t ready yet. Please retry shortly.");
      }
      const source = transcriptStore
        .getSnapshot(conversationId)
        .messages.find((row) => row.id === forwardMessageId);
      const entry = messageDecryptor.get(forwardMessageId);
      if (!source || source.deletedAt || !isPayload(entry)) {
        throw new Error("This message is no longer available.");
      }
      const trimmed = caption.trim();
      const payload: MessagePayload =
        entry.type === "post"
          ? {
              content: trimmed || entry.content,
              postId: entry.postId,
              type: "post",
            }
          : { content: trimmed || messageSummary(entry), type: "text" };
      const options = await apiOptions();
      const { conversation: target } = await createConversation(
        recipientId,
        options
      );
      const rootKey = await ensureConversationKeys(target, privateKey, userId, {
        postKeys: (keyTarget, keys) =>
          postConversationKeys(keyTarget, keys, options),
        refreshConversation: async () => {
          const fresh = await fetchConversationDetail(target.id, options);
          return fresh.conversation;
        },
      });
      invalidateKeys(target.id);
      if (!rootKey) {
        throw new Error("Message keys aren't ready yet");
      }
      let baseIndex = 0;
      for (const row of transcriptStore.getSnapshot(target.id).messages) {
        if (row.senderId === userId) {
          baseIndex = Math.max(baseIndex, row.ratchetIndex + 1);
        }
      }
      const sent = await sendEncryptedMessage(
        target.id,
        rootKey,
        userId,
        baseIndex,
        payload,
        options
      );
      transcriptStore.appendMessage(target.id, sent);
      setForwardMessageId(null);
      setOptionsMessageId(null);
    },
    [
      apiOptions,
      conversationId,
      forwardMessageId,
      invalidateKeys,
      privateKey,
      userId,
    ]
  );
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
    conversationId,
    decrypted,
    foreground,
    getBaseKeys,
    items,
    loadAround: transcript.loadAround,
    messages,
    onClose: () => {
      setSearchOpen(false);
      transcript.loadNewest();
    },
    open: searchOpen && !activeIncognito,
    scope: userId
      ? `${userId}:${identity?.publicKey ?? "pending"}:${conversationId}`
      : null,
    scrollToIndex: scrollToSearchIndex,
    scrollToOffset: scrollToSearchOffset,
  });

  // A global search hit opens the thread at that message (web's `mid`). The
  // jump waits for the first page so the anchored window replaces a settled
  // transcript, and fires once per requested id. The timer clears the search
  // hook's mount-time highlight reset (150 ms) so the shimmer survives.
  const jumpToRequested = useRef(search.handleJumpTo);
  useEffect(() => {
    jumpToRequested.current = search.handleJumpTo;
  }, [search.handleJumpTo]);
  const requestedJump = useRef<string | null>(null);
  const transcriptReady = transcript.snapshot.initialLoaded;
  useEffect(() => {
    if (
      !requestedMessageId ||
      requestedJump.current === requestedMessageId ||
      status !== "ready" ||
      !transcriptReady
    ) {
      return;
    }
    const timer = setTimeout(() => {
      requestedJump.current = requestedMessageId;
      jumpToRequested.current(requestedMessageId, false);
    }, 200);
    return () => clearTimeout(timer);
  }, [requestedMessageId, status, transcriptReady]);

  const currentConversation = conversation ?? cachedPeer?.conversation ?? null;
  const isDen = currentConversation
    ? conversationKind(currentConversation) === "DEN"
    : false;
  const hasLeft = currentConversation
    ? conversationLeft(currentConversation, userId)
    : false;
  const headerName = currentConversation
    ? conversationName(currentConversation, userId)
    : (peer?.displayName ?? "Chat");
  // ---- render ----------------------------------------------------------------

  const renderItem = useCallback(
    ({ item }: { item: TranscriptItem }) => {
      if (item.kind === "incognito") {
        return <NativeIncognitoUsageNotice session={item.session} />;
      }
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
          mine={mine}
          selected={selectedIds.has(message.id)}
          selectionActive={selectionActive}
          onToggle={toggleSelected}
          swipeId={swipeId}
          swipeX={swipeX}
        >
          <View style={{ width: "100%" }}>
            {isDen && !mine && groupMetaFor(message.id).isFirstInGroup ? (
              <Text
                style={{
                  color: theme.dividerText,
                  fontFamily: "SofiaProMed",
                  fontSize: 12,
                  marginBottom: 4,
                  marginLeft: 44,
                }}
              >
                {message.sender?.displayName ??
                  currentConversation?.members.find(
                    (member) => member.userId === message.senderId
                  )?.user.displayName ??
                  "Member"}
              </Text>
            ) : null}
            <MessageBubble
              entrances={transcriptStore.getEntrances(conversationId)}
              messageId={message.id}
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
              onOpenViewOnce={openViewOnce}
              conversationId={conversationId}
              onCloseViewOnce={closeViewOnce}
              onRetry={() => retryRow(message)}
              onReact={(emoji) => {
                void handleMessageReaction(message.id, emoji);
              }}
              reactionPending={reactionPendingIds.has(message.id)}
              payload={isPayload(entry) ? entry : null}
              reactions={message.reactions ?? []}
              peerAvatarUrl={
                isDen
                  ? (message.sender?.avatarUrl ??
                    currentConversation?.members.find(
                      (member) => member.userId === message.senderId
                    )?.user.avatarUrl)
                  : (peer?.avatarUrl ?? cachedPeer?.avatarUrl ?? null)
              }
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
          </View>
        </SelectableMessageRow>
      );
    },
    [
      conversationId,
      search.activeId,
      search.jump,
      currentConversation,
      isDen,
      chatTheme,
      cachedPeer?.avatarUrl,
      peer?.avatarUrl,
      width,
      decrypted,
      groupMetaFor,
      handleMessageReaction,
      openViewer,
      retryRow,
      theme.dividerText,
      transcript.snapshot.peerWatermarks,
      userId,
      selectedIds,
      reactionPendingIds,
      selectionActive,
      toggleSelected,
      swipeId,
      swipeX,
      messages,
      openViewOnce,
      closeViewOnce,
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
      <AppThemeOverride value={activeIncognito ? "dark" : null}>
        {selectionActive && !activeIncognito ? (
          <View
            style={[styles.header, { borderBottomColor: theme.dividerLine }]}
          >
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
              <>
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
                <MessagesIconButton
                  icon={Smile}
                  label="React to selected message"
                  onPress={() => {
                    const [id] = selectedIds;
                    if (id) {
                      clearSelection();
                      setReactionTarget(id);
                    }
                  }}
                  size={32}
                />
              </>
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
            <MessagesIconButton
              icon={Trash2}
              label="Delete selected messages"
              onPress={requestDeleteSelectedForMe}
              size={32}
            />
            {selectedIds.size === 1 ? (
              <MessagesIconButton
                icon={MoreHorizontal}
                label="More options for selected message"
                onPress={() => {
                  const [id] = selectedIds;
                  if (id) {
                    setOptionsMessageId(id);
                  }
                }}
                size={32}
              />
            ) : null}
          </View>
        ) : (
          <ThreadHeader
            avatarUrl={peer?.avatarUrl ?? cachedPeer?.avatarUrl ?? null}
            displayName={headerName}
            username={peer?.username ?? cachedPeerUser?.username ?? null}
            conversation={isDen ? currentConversation : null}
            onDetails={() => setDetailsOpen(true)}
            badge={peer?.badge ?? cachedPeerUser?.badge}
            badges={peer?.badges ?? cachedPeerUser?.badges}
            communityRoles={
              peer?.communityMemberships ?? cachedPeerUser?.communityMemberships
            }
            onBack={onBack}
            onSearch={() => {
              if (searchOpen) {
                search.handleClose();
              } else {
                setSearchOpen(true);
              }
            }}
            presence={
              presence.find(
                (entry) => entry.id === (peer?.id ?? cachedPeer?.peerId)
              )?.status ?? null
            }
            typing={transcript.snapshot.peerTyping}
          />
        )}
      </AppThemeOverride>
      <ChatModeTransition
        sessionId={activeIncognito?.id ?? null}
        incognito={
          activeIncognito && lifecycleOptions ? (
            <AppThemeOverride value="dark">
              <NativeIncognitoThread
                conversationId={conversationId}
                session={activeIncognito}
                options={lifecycleOptions}
                revision={lifecycleRevision + contentRevision}
                fresh={incognitoFresh}
                serverOffset={serverOffset}
                onRefresh={refreshLifecycle}
                busy={lifecycleBusy}
                error={lifecycleError}
              />
            </AppThemeOverride>
          ) : null
        }
      >
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
            statusLabel={search.statusLabel}
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
            <Text
              style={{ color: theme.dividerText, fontFamily: "SofiaProReg" }}
            >
              Couldn't connect to Messages. Tap to retry.
            </Text>
          </Pressable>
        ) : null}
        <View
          ref={transcriptViewportRef}
          onLayout={handleViewportLayout}
          style={{ flex: 1 }}
        >
          {prefs.wallpaperKey === "doodle" || prefs.wallpaperMediaId ? (
            <View style={StyleSheet.absoluteFill} pointerEvents="none">
              <Image
                source={
                  prefs.wallpaperMediaId
                    ? {
                        headers: mediaCookie ? { Cookie: mediaCookie } : {},
                        uri: `${getApiBaseUrl()}/api/media/${prefs.wallpaperMediaId}/v/lg-webp.webp`,
                      }
                    : chatDoodle
                }
                contentFit="cover"
                style={StyleSheet.absoluteFill}
              />
              <View
                style={[
                  StyleSheet.absoluteFill,
                  {
                    backgroundColor: `rgba(0,0,0,${(prefs.wallpaperDim ?? 40) / 100})`,
                  },
                ]}
              />
            </View>
          ) : null}
          {(status === "loading" || transcript.snapshot.loading) &&
          messages.length === 0 ? (
            <ThreadSkeleton />
          ) : (
            <GestureDetector gesture={gesture}>
              <Animated.View style={{ flex: 1 }}>
                <GestureDetector gesture={nativeScroll}>
                  <AnimatedTranscriptList
                    contentContainerStyle={[
                      styles.listContent,
                      items.length === 0 && {
                        flexGrow: 1,
                        justifyContent: "center",
                      },
                    ]}
                    ListEmptyComponent={
                      searchOpen ? undefined : (
                        <View style={{ transform: [{ scaleY: -1 }] }}>
                          <ConversationGreeting
                            isDen={isDen}
                            name={headerName}
                          />
                        </View>
                      )
                    }
                    ref={threadListRef}
                    data={items}
                    {...LIST_VIRTUALIZATION_PROPS}
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
          {transcript.snapshot.hasMoreNewer &&
          !(searchOpen && search.listView) ? (
            <Pressable
              accessibilityLabel="Scroll to latest messages"
              onPress={() => {
                if (searchOpen) {
                  search.handleClose();
                } else {
                  transcript.loadNewest();
                }
              }}
              style={{
                backgroundColor: theme.cardBg,
                borderColor: theme.dividerLine,
                borderRadius: 24,
                borderWidth: 1,
                bottom: 12,
                padding: 12,
                position: "absolute",
                right: 16,
              }}
            >
              <Text style={{ color: theme.inputText, fontSize: 18 }}>↓</Text>
            </Pressable>
          ) : null}
          {searchOpen && search.listView ? (
            <MessageSearchResults
              results={search.page.pageResults}
              messages={search.resultMessages}
              activeId={search.activeId}
              userId={userId}
              peerName={peer?.displayName ?? cachedPeer?.displayName ?? "them"}
              onJump={search.handleJumpTo}
              emptyLabel={search.emptyLabel}
            />
          ) : null}
        </View>
        {transcript.snapshot.peerTyping ? <TypingDots /> : null}
        {hasLeft ? (
          <View style={{ padding: 16 }}>
            <Text
              style={{
                color: theme.dividerText,
                fontFamily: "SofiaProReg",
                textAlign: "center",
              }}
            >
              You left this den. Your history remains available.
            </Text>
          </View>
        ) : (
          <MessageComposer
            conversationId={conversationId}
            stickersEnabled
            peerName={headerName}
            disabled={status !== "ready" || readyKey !== privateKey}
            editing={editing}
            onCancelEdit={() => setEditing(null)}
            onCancelReply={() => setReplyTo(null)}
            onSend={handleSend}
            onSaveEdit={handleSaveEdit}
            onTyping={() => {
              void (async () => {
                const options = await apiOptions();
                await sendTypingIndicator(conversationId, options);
              })();
            }}
            replyTo={replyTo}
          />
        )}
      </ChatModeTransition>
      {detailsPlacement({
        collapsed: false,
        // Native has no desktop rail: the bottom sheet is the only surface, so
        // this always resolves to the sheet branch, like web below `lg`.
        desktopViewport: false,
        requested: detailsOpen,
      }) === "sheet" &&
      currentConversation &&
      userId ? (
        <ConversationDetails
          conversation={currentConversation}
          contentRevision={messages
            .map(
              (message) =>
                `${message.id}:${message.revision}:${message.deletedAt ?? ""}`
            )
            .join("|")}
          userId={userId}
          prefs={prefs}
          getBaseKeys={getBaseKeys}
          onPrefs={(next) => {
            setPrefs(next);
            setThemeKey(next.themeKey);
            conversationListStore.setMuted(
              conversationId,
              Boolean(next.mutedAt)
            );
          }}
          onClose={() => setDetailsOpen(false)}
          onJump={search.handleJumpTo}
          onRefresh={() => setDetailRevision((value) => value + 1)}
        />
      ) : null}
      {viewer ? (
        <MessageMediaViewer
          images={viewer.images}
          index={viewer.index}
          onClose={() => setViewer(null)}
        />
      ) : null}
      {reactionTarget ? (
        <MessageReactionSheet
          onClose={() => setReactionTarget(null)}
          onReact={(emoji) => {
            const target = reactionTarget;
            setReactionTarget(null);
            void handleMessageReaction(target, emoji);
          }}
        />
      ) : null}
      {optionsMessage ? (
        <MessageSheet
          onClose={() => setOptionsMessageId(null)}
          open
          title="Message options"
        >
          <MessageOptionsSheet
            canDeleteForEveryone={canDeleteForEveryone(optionsMessage, userId)}
            canEdit={canEditMessage(optionsMessage, userId)}
            canForward={(() => {
              const entry = decrypted.get(optionsMessage.id);
              return (
                isPayload(entry) &&
                (entry.type === "text" || entry.type === "post")
              );
            })()}
            createdAt={optionsMessage.createdAt}
            editedAt={optionsMessage.editedAt}
            onCopy={() => {
              copyMessage(optionsMessage.id);
              setOptionsMessageId(null);
            }}
            onDeleteEveryone={() => requestDeleteForEveryone(optionsMessage)}
            onDeleteMe={() => requestDeleteForMe(optionsMessage)}
            onEdit={() => handleEditMessage(optionsMessage)}
            onForward={() => {
              setOptionsMessageId(null);
              setForwardMessageId(optionsMessage.id);
            }}
            onMoreReactions={() => {
              setOptionsMessageId(null);
              setReactionTarget(optionsMessage.id);
            }}
            onReact={(emoji) => {
              void handleMessageReaction(optionsMessage.id, emoji);
            }}
            onReply={() => {
              handleReply(optionsMessage.id);
              setOptionsMessageId(null);
            }}
            onSelect={() => {
              toggleSelected(optionsMessage.id);
              setOptionsMessageId(null);
            }}
            reactionPending={reactionPendingIds.has(optionsMessage.id)}
            receipt={getMessageReceipt({
              createdAt: optionsMessage.createdAt,
              mine: optionsMessage.senderId === userId,
              watermarks: transcript.snapshot.peerWatermarks,
            })}
          />
        </MessageSheet>
      ) : null}
      {pendingDelete ? (
        <MessageDeleteDialog
          busy={deleteBusy}
          copy={messageDeleteCopy({
            count: pendingDeleteCount(pendingDelete),
            scope: pendingDelete.scope,
          })}
          onConfirm={() => {
            void confirmPendingDelete();
          }}
          onOpenChange={(open) => {
            if (!open && !deleteBusy) {
              setDeleteOpen(false);
              setPendingDelete(null);
            }
          }}
          open={deleteOpen}
        />
      ) : null}
      {forwardMessageId ? (
        <MessageSheet
          onClose={() => setForwardMessageId(null)}
          open
          title="Forward message"
        >
          <MessageSharePicker
            onShare={(recipientId, caption) =>
              forwardToConversation(recipientId, caption)
            }
          />
        </MessageSheet>
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
    if ("attachments" in payload) {
      return payload.attachments.some((attachment) => attachment.kind === "gif")
        ? "GIF"
        : "Photo";
    }
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

// The header keeps the peer's badges and presence beside their identity.
function ThreadHeader({
  avatarUrl,
  displayName,
  username,
  badge,
  badges,
  communityRoles,
  onBack,
  onSearch,
  typing,
  presence,
  conversation,
  onDetails,
}: {
  conversation: MessageConversationData | null;
  onDetails: () => void;
  avatarUrl: string | null;
  displayName: string;
  username: string | null;
  badge?: string | null;
  badges?: string[];
  communityRoles?: MessageSender["communityMemberships"];
  onBack: () => void;
  onSearch: () => void;
  typing: boolean;
  presence: "online" | "idle" | null;
}) {
  const { isDark, theme } = useAppTheme();
  const { snapshot: lifecycle, busy, mutate } = useNativeChatLifecycle();
  const activeIncognito =
    lifecycle?.activeSession?.endedAt === null ? lifecycle.activeSession : null;
  const endIncognito = () => {
    if (!activeIncognito || busy) {
      return;
    }
    Alert.alert(
      "End incognito for both of you?",
      "All messages and attachments in this session will be deleted, including unread messages.",
      [
        { style: "cancel", text: "Keep chatting" },
        {
          onPress: async () => {
            const ended = await mutate({
              action: "end-incognito",
              sessionId: activeIncognito.id,
            });
            if (!ended) {
              Alert.alert(
                "Couldn't end incognito",
                "Check your connection and try again."
              );
            }
          },
          style: "destructive",
          text: "End and delete",
        },
      ]
    );
  };
  let statusText = username ? `@${username}` : "";
  if (conversation) {
    statusText = `${conversation.members.filter((member) => !member.leftAt).length} members`;
  }
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
      <Pressable
        onPress={onDetails}
        accessibilityRole="button"
        accessibilityLabel={`Conversation details for ${displayName}`}
        style={{
          alignItems: "center",
          flex: 1,
          flexDirection: "row",
          gap: 8,
          minWidth: 0,
        }}
      >
        <View style={styles.headerAvatar}>
          {conversation ? (
            <DenAvatar conversation={conversation} size={32} />
          ) : (
            <UserAvatar size={32} url={avatarUrl} />
          )}
          {conversation ? null : (
            <MessagePresenceIndicator
              status={presence}
              testID="chat-header-presence"
            />
          )}
        </View>
        <View style={styles.headerIdentity}>
          <View style={styles.headerNameRow}>
            <Text
              numberOfLines={1}
              style={[
                styles.headerName,
                { color: isDark ? "#eeeeee" : "#202020" },
              ]}
            >
              {displayName}
            </Text>
            {conversation ? null : (
              <UserBadge
                badge={badge}
                badges={badges}
                communityRoles={communityRoles}
              />
            )}
          </View>
          {(() => {
            if (activeIncognito) {
              return (
                <View
                  style={{ alignItems: "center", flexDirection: "row", gap: 4 }}
                >
                  <Shield size={11} color={theme.dividerText} />
                  <Text
                    style={[styles.headerSub, { color: theme.dividerText }]}
                  >
                    Incognito
                  </Text>
                </View>
              );
            }
            if (typing) {
              return (
                <Text style={[styles.headerSub, { color: theme.dividerText }]}>
                  typing...
                </Text>
              );
            }
            return (
              <Text
                numberOfLines={1}
                style={[styles.headerSub, { color: theme.dividerText }]}
              >
                {statusText}
              </Text>
            );
          })()}
        </View>
      </Pressable>
      {activeIncognito ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          onPress={endIncognito}
          hitSlop={8}
          style={({ pressed }) => ({
            backgroundColor: pressed ? theme.cardBg : "transparent",
            borderRadius: 20,
            justifyContent: "center",
            minHeight: 40,
            opacity: busy ? 0.5 : 1,
            paddingHorizontal: 12,
          })}
        >
          <Text
            style={{
              color: theme.inputText,
              fontFamily: "SofiaProMed",
              fontSize: 12,
            }}
          >
            End chat
          </Text>
        </Pressable>
      ) : (
        <MessagesIconButton
          icon={Search}
          label="Search in conversation"
          onPress={onSearch}
          size={32}
        />
      )}
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
  header: {
    alignItems: "center",
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 8,
    height: 56,
    paddingHorizontal: 12,
  },
  headerAvatar: { height: 32, width: 32 },
  headerIdentity: {
    flex: 1,
    minWidth: 0,
  },
  headerName: {
    flexShrink: 1,
    fontFamily: "SofiaProMed",
    fontSize: 14,
  },
  headerNameRow: { alignItems: "center", flexDirection: "row", gap: 5 },
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
