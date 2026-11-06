import type {
  BubbleEntranceRegistry,
  MessageReactionSummary,
} from "@asm/messages";
// One transcript row: the bubble, its media album, its reply quote, and the
// receipt. Ported from apps/web/src/components/messages/message-bubble.tsx and
// message-media-album.tsx.
//
// The visual language is web's: `.bubble-sent` is a theme-driven gradient with a
// dual border, `.bubble-received` is a neutral surface with a translucent top-lit
// wash, and a run of messages from one sender interlocks through four corner radii
// so the block reads as one paragraph (see message-bubble-shape.ts).
//
// Row height is measured, not estimated. A FlatList has to know how tall a row is
// before it renders it, and a bubble containing a photo has no predictable height
// until the photo reports its intrinsic size, so the row reports it through
// onLayout. Without that a long album scrolls to the wrong place.
import { formatViewOnceSeenAt, isViewOnceUnavailable } from "@asm/messages";
import { isStickerMessagePayload } from "@asm/messages/payload";
import { randomUUID } from "expo-crypto";
import { File, Directory, Paths } from "expo-file-system";
import { Image as ExpoImage } from "expo-image";
import { useFocusEffect } from "expo-router";
import * as Sharing from "expo-sharing";
import { VideoView, useVideoPlayer } from "expo-video";
import { Download, Eye, FileText, X } from "lucide-react-native";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  AppState,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { UserAvatar } from "@/components/avatar/user-avatar";
import { toast } from "@/components/feedback/toast";
import { ZephLoader } from "@/components/feedback/zeph-loader";
import { Gradient3D } from "@/components/surface/gradient-3d";
import { authClient } from "@/features/auth/lib/auth-client";
import { sentBubbleShadows } from "@/features/messages/lib/conversation-theme";
import type { ConversationTheme } from "@/features/messages/lib/conversation-theme";
import type { MessagePayload } from "@/features/messages/lib/crypto";
import {
  getMediaAttachments,
  getMediaImages,
} from "@/features/messages/lib/crypto";
import {
  albumHeightForWidth,
  albumTileFrames,
  getAlbumLayout,
  singleMessageImageHeight,
} from "@/features/messages/lib/message-album-layout";
import {
  bubbleCorners,
  bubblePosition,
} from "@/features/messages/lib/message-bubble-shape";
import type { BubbleCorners } from "@/features/messages/lib/message-bubble-shape";
import type { MessageGroupMeta } from "@/features/messages/lib/message-grouping";
import { formatReceiptStamp } from "@/features/messages/lib/message-grouping";
import { messageImageSource } from "@/features/messages/lib/message-image-source";
import type { MessageReceiptInfo } from "@/features/messages/lib/message-receipts";
import {
  bubbleSentStops,
  panel3d,
} from "@/features/messages/lib/message-recipes";
import { deleteViewOncePhoto } from "@/features/messages/lib/view-once-client";
import { useMessagesIdentity } from "@/features/messages/state/message-identity";
import { useMessagesForeground } from "@/features/messages/state/use-messages-foreground";
import { useViewOnceReceipt } from "@/features/messages/state/use-view-once-receipt";
import { getApiBaseUrl } from "@/lib/network/api-env";
import { useAppTheme } from "@/theme";

import { MessageBubbleEntrance } from "./message-bubble-entrance";
import { MessagePostPreview } from "./message-post-preview";
import { MessageSearchHighlight } from "./message-search-highlight";
import {
  DeletedBubble,
  MessageImage,
  ReceivedBubbleSurface,
  ReceiptLine,
  mediaUrl,
} from "./messages-primitives";
// oxlint-disable react/immutability -- Reanimated shared values are mutable animation handles, not React state.
import { SavableSticker } from "./savable-sticker";

// The album's rendered width. Web caps the collage at 384px; on a phone the bubble
// itself is the cap, and this is the ceiling inside it.
const ALBUM_MAX_WIDTH = 384;
const MAX_BUBBLE_WIDTH_RATIO = 0.85;
const EMPTY_REACTIONS: MessageReactionSummary[] = [];

function closeViewOnceQuietly(
  onClose: (mediaId: string, grantId: string) => Promise<void>,
  mediaId: string,
  grantId: string
): void {
  void (async () => {
    try {
      await onClose(mediaId, grantId);
    } catch {
      // The server expires abandoned grants if this best-effort close is offline.
    }
  })();
}

function ViewOncePhoto({
  canOpen,
  conversationId,
  mediaId,
  onClose,
  onOpen,
}: {
  canOpen: boolean;
  conversationId?: string;
  mediaId: string;
  onClose?: (mediaId: string, grantId: string) => Promise<void>;
  onOpen?: (
    mediaId: string,
    grantId: string,
    signal?: AbortSignal
  ) => Promise<string>;
}) {
  const insets = useSafeAreaInsets();
  const foreground = useMessagesForeground();
  const receipt = useViewOnceReceipt(conversationId, mediaId);
  const seenLabel = formatViewOnceSeenAt(receipt.data?.seenAt);
  const receiptUnavailable =
    receipt.data?.unavailable || isViewOnceUnavailable(receipt.error);
  const acknowledgedGrant = useRef<string | null>(null);
  const reduceMotion = useReducedMotion();
  const eyeScale = useSharedValue(1);
  const eyeStyle = useAnimatedStyle(() => ({
    transform: [{ scaleY: eyeScale.value }],
  }));
  useEffect(() => {
    if (foreground && !reduceMotion) {
      eyeScale.value = withSequence(
        withDelay(190, withTiming(0.14, { duration: 90 })),
        withTiming(1, { duration: 180 })
      );
    }
    return () => {
      cancelAnimation(eyeScale);
      eyeScale.value = 1;
    };
  }, [eyeScale, foreground, reduceMotion]);
  const [busy, setBusy] = useState(false);
  const [opened, setOpened] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [uri, setUri] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const grantIdRef = useRef<string | null>(null);
  const uriRef = useRef<string | null>(null);

  const close = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    const currentUri = uriRef.current;
    uriRef.current = null;
    if (currentUri) {
      deleteViewOncePhoto(currentUri);
    }
    setUri(null);
    setBusy(false);
    const grantId = grantIdRef.current;
    grantIdRef.current = null;
    if (grantId && onClose) {
      closeViewOnceQuietly(onClose, mediaId, grantId);
    }
  }, [mediaId, onClose]);

  useEffect(
    () => () => {
      controllerRef.current?.abort();
      if (uriRef.current) {
        deleteViewOncePhoto(uriRef.current);
      }
      const grantId = grantIdRef.current;
      if (grantId && onClose) {
        closeViewOnceQuietly(onClose, mediaId, grantId);
      }
    },
    [mediaId, onClose]
  );

  useFocusEffect(useCallback(() => () => close(), [close]));
  useEffect(() => {
    if (!busy && !uri) {
      return;
    }
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        close();
      }
    });
    return () => subscription.remove();
  }, [busy, close, uri]);

  const open = useCallback(async () => {
    if (
      !canOpen ||
      !onOpen ||
      controllerRef.current ||
      busy ||
      receiptUnavailable ||
      opened ||
      unavailable
    ) {
      return;
    }
    const grantId = randomUUID();
    const controller = new AbortController();
    grantIdRef.current = grantId;
    controllerRef.current = controller;
    setBusy(true);
    setOpenError(null);
    try {
      const localUri = await onOpen(mediaId, grantId, controller.signal);
      if (controller.signal.aborted || controllerRef.current !== controller) {
        deleteViewOncePhoto(localUri);
        if (onClose) {
          closeViewOnceQuietly(onClose, mediaId, grantId);
        }
        return;
      }
      uriRef.current = localUri;
      setUri(localUri);
      setOpened(true);
    } catch (error) {
      if (grantIdRef.current === grantId) {
        grantIdRef.current = null;
      }
      const status =
        typeof error === "object" && error !== null && "status" in error
          ? error.status
          : null;
      if (status === 410 || status === 404) {
        setUnavailable(true);
      } else if (!controller.signal.aborted) {
        setOpenError("Couldn't open. Try again.");
      }
      if (onClose) {
        closeViewOnceQuietly(onClose, mediaId, grantId);
      }
    }
    if (controllerRef.current === controller) {
      controllerRef.current = null;
      setBusy(false);
    }
  }, [
    busy,
    canOpen,
    mediaId,
    onClose,
    onOpen,
    opened,
    unavailable,
    receiptUnavailable,
  ]);

  let label = "View once photo";
  if (seenLabel) {
    label = seenLabel;
  } else if (opened) {
    label = "Opened";
  } else if (unavailable || receiptUnavailable) {
    label = "No longer available";
  }
  let accessibilityLabel = label;
  if (canOpen && !seenLabel) {
    accessibilityLabel = opened ? "Opened photo" : "Open view once photo";
  }
  return (
    <>
      <Pressable
        accessibilityLabel={accessibilityLabel}
        accessibilityRole={canOpen ? "button" : "text"}
        disabled={
          !canOpen ||
          busy ||
          opened ||
          unavailable ||
          receiptUnavailable ||
          !onOpen
        }
        onPress={open}
        style={[styles.fileCard, styles.viewOnceCard]}
      >
        {busy ? (
          <ZephLoader variant="messages" color="#9a9a9a" size={20} />
        ) : (
          <Animated.View style={eyeStyle}>
            <Eye color="#9a9a9a" size={20} />
          </Animated.View>
        )}
        <View style={styles.viewOnceCopy}>
          <Text style={styles.fileName}>{label}</Text>
          {openError ? (
            <Text style={styles.viewOnceError}>{openError}</Text>
          ) : null}
        </View>
        {canOpen &&
        !seenLabel &&
        !opened &&
        !unavailable &&
        !receiptUnavailable &&
        !busy ? (
          <Text style={styles.viewOnceOpen}>Open</Text>
        ) : null}
      </Pressable>
      <Modal
        animationType="fade"
        onRequestClose={close}
        statusBarTranslucent
        transparent
        visible={Boolean(uri)}
      >
        <View style={styles.viewOnceModal}>
          {uri ? (
            <ExpoImage
              cachePolicy="none"
              onError={() => {
                setOpenError("This photo couldn't be displayed.");
                close();
              }}
              onDisplay={() => {
                const grant = grantIdRef.current;
                if (
                  grant &&
                  conversationId &&
                  acknowledgedGrant.current !== grant
                ) {
                  acknowledgedGrant.current = grant;
                  receipt.confirm(grant);
                }
              }}
              contentFit="contain"
              source={{ uri }}
              style={styles.viewOnceImage}
            />
          ) : null}
          <Pressable
            accessibilityLabel="Close photo"
            accessibilityRole="button"
            hitSlop={10}
            onPress={close}
            style={[styles.viewOnceClose, { top: insets.top + 12 }]}
          >
            <X color="#ffffff" size={21} />
          </Pressable>
        </View>
      </Modal>
    </>
  );
}

export interface MessageBubbleProps {
  entrances?: BubbleEntranceRegistry;
  messageId?: string;
  conversationId?: string;
  ephemeral?: boolean;
  searchJump?: number;
  deleted: boolean;
  edited: boolean;
  group: MessageGroupMeta;
  mine: boolean;
  /** Null while the row is still decrypting. */
  payload: MessagePayload | null;
  /** True when the row could not be decrypted at all. */
  failed: boolean;
  onRetry?: () => void;
  onPressImage?: (index: number) => void;
  onOpenViewOnce?: (
    mediaId: string,
    grantId: string,
    signal?: AbortSignal
  ) => Promise<string>;
  onCloseViewOnce?: (mediaId: string, grantId: string) => Promise<void>;
  onReact?: (emoji: string) => void;
  reactionPending?: boolean;
  reactions?: MessageReactionSummary[];
  /** The message this one replies to, if it is loaded. */
  replyPreview?: { senderId: string; text: string } | null;
  peerAvatarUrl?: string | null;
  receipt?: MessageReceiptInfo | null;
  theme: ConversationTheme;
  /** Fraction of the screen the bubble may occupy. */
  maxBubbleWidth: number;
  showReceipt: boolean;
}

function MessageBubbleInner({
  messageId,
  conversationId,
  ephemeral = false,
  searchJump = 0,
  deleted,
  edited,
  failed,
  group,
  maxBubbleWidth,
  mine,
  onPressImage,
  onOpenViewOnce,
  onCloseViewOnce,
  onReact,
  reactionPending = false,
  onRetry,
  peerAvatarUrl,
  payload,
  receipt,
  replyPreview,
  reactions = EMPTY_REACTIONS,
  showReceipt,
  theme,
}: MessageBubbleProps) {
  const { isDark } = useAppTheme();
  const position = bubblePosition(group.isFirstInGroup, group.isLastInGroup);
  const corners = bubbleCorners(position, mine);

  // A deleted row keeps its slot and its tail so the transcript does not reflow
  // around a hole, but it says so rather than rendering whatever the ciphertext
  // still decrypts to.
  if (deleted) {
    return (
      <View
        style={[
          styles.row,
          mine ? styles.rowMine : styles.rowTheirs,
          { marginTop: group.isFirstInGroup ? 8 : 2 },
        ]}
      >
        <DeletedBubble
          maxWidth={Math.round(maxBubbleWidth * MAX_BUBBLE_WIDTH_RATIO)}
          mine={mine}
        />
      </View>
    );
  }

  if (failed) {
    return (
      <View
        style={[
          styles.row,
          mine ? styles.rowMine : styles.rowTheirs,
          { marginTop: group.isFirstInGroup ? 8 : 2 },
        ]}
      >
        <ReceivedBubbleSurface corners={corners}>
          <Text style={styles.failedText}>
            This message couldn't be decrypted.
          </Text>
          {onRetry ? (
            <Text onPress={onRetry} style={styles.retry}>
              Retry
            </Text>
          ) : null}
        </ReceivedBubbleSurface>
      </View>
    );
  }

  if (!payload) {
    return (
      <View
        style={[
          styles.row,
          mine ? styles.rowMine : styles.rowTheirs,
          { marginTop: group.isFirstInGroup ? 8 : 2 },
        ]}
      >
        <PendingBubble mine={mine} width={Math.round(maxBubbleWidth * 0.4)} />
      </View>
    );
  }

  const bubbleWidth = Math.round(maxBubbleWidth * MAX_BUBBLE_WIDTH_RATIO);

  if (payload.type === "media") {
    if (isStickerMessagePayload(payload)) {
      const ratio =
        payload.width && payload.height ? payload.width / payload.height : 1;
      const stickerWidth = ratio >= 1 ? 192 : Math.max(88, 192 * ratio);
      const stickerHeight = ratio >= 1 ? Math.max(88, 192 / ratio) : 192;
      return (
        <View
          style={[
            styles.row,
            mine ? styles.rowMine : styles.rowTheirs,
            { marginTop: group.isFirstInGroup ? 8 : 2 },
          ]}
        >
          <View style={mine ? styles.alignEnd : styles.alignStart}>
            <SavableSticker
              mediaId={payload.sticker.mediaId}
              messageId={messageId ?? ""}
              canSave={!ephemeral && Boolean(messageId)}
            >
              <MessageImage
                cachePolicy={ephemeral ? "none" : undefined}
                contentFit="contain"
                source={mediaUrl(payload.url)}
                style={{ height: stickerHeight, width: stickerWidth }}
              />
            </SavableSticker>
            <ReactionPills
              disabled={reactionPending}
              mine={mine}
              onReact={onReact}
              reactions={reactions}
            />
          </View>
          {showReceipt && mine && receipt ? (
            <ReceiptLine
              at={formatReceiptStamp(receipt.at)}
              label={receipt.status}
            />
          ) : null}
        </View>
      );
    }
    const attachments = getMediaAttachments(payload);
    const images = getMediaImages(payload);
    const mixedPhotoKinds =
      attachments.some((attachment) => attachment.kind === "image") &&
      attachments.some((attachment) => attachment.kind === "gif");
    if (
      mixedPhotoKinds ||
      attachments.some((attachment) =>
        ["file", "video", "view-once"].includes(attachment.kind)
      )
    ) {
      return (
        <View
          style={[
            styles.row,
            mine ? styles.rowMine : styles.rowTheirs,
            { marginTop: group.isFirstInGroup ? 8 : 2 },
          ]}
        >
          <View
            style={[
              styles.attachmentList,
              { maxWidth: albumWidthForBubble(bubbleWidth) },
            ]}
          >
            {attachments.map((attachment, index) => {
              if (attachment.kind === "image" || attachment.kind === "gif") {
                const currentImageIndex = attachments
                  .slice(0, index)
                  .filter(
                    (previous) =>
                      previous.kind === "image" || previous.kind === "gif"
                  ).length;
                return (
                  <Pressable
                    accessibilityLabel={
                      attachment.kind === "gif" ? "Open GIF" : "Open image"
                    }
                    key={`${attachment.url}-${index}`}
                    onPress={() => onPressImage?.(currentImageIndex)}
                    style={styles.mixedImageFrame}
                  >
                    <MessageImage
                      cachePolicy={ephemeral ? "none" : undefined}
                      contentFit="contain"
                      source={mediaUrl(attachment.url)}
                      style={StyleSheet.absoluteFill}
                    />
                  </Pressable>
                );
              }
              if (attachment.kind === "video") {
                return (
                  <MessageVideoAttachment
                    key={attachment.url}
                    url={mediaUrl(attachment.url)}
                  />
                );
              }
              if (attachment.kind === "file") {
                return (
                  <MessageFileAttachment
                    attachment={attachment}
                    key={attachment.url}
                    mine={mine}
                  />
                );
              }
              if (attachment.kind === "view-once") {
                return (
                  <ViewOncePhoto
                    canOpen={!mine}
                    conversationId={conversationId}
                    key={`view-once-${attachment.ref}-${index}`}
                    mediaId={attachment.ref}
                    onClose={onCloseViewOnce}
                    onOpen={onOpenViewOnce}
                  />
                );
              }
              return null;
            })}
            {payload.content ? (
              <Text
                style={[
                  styles.mediaCaption,
                  { color: mine ? "#ffffff" : undefined },
                ]}
              >
                {payload.content}
              </Text>
            ) : null}
            <ReactionPills
              disabled={reactionPending}
              mine={mine}
              onReact={onReact}
              reactions={reactions}
            />
          </View>
          {showReceipt &&
          mine &&
          receipt &&
          !attachments.some((attachment) => attachment.kind === "view-once") ? (
            <ReceiptLine
              at={formatReceiptStamp(receipt.at)}
              label={receipt.status}
            />
          ) : null}
        </View>
      );
    }
    const layout = getAlbumLayout(images.length);
    const albumWidth = Math.min(ALBUM_MAX_WIDTH, bubbleWidth);
    const albumHeight =
      images.length === 1
        ? singleMessageImageHeight(albumWidth, images[0])
        : albumHeightForWidth(layout, albumWidth);
    return (
      <View
        style={[
          styles.row,
          mine ? styles.rowMine : styles.rowTheirs,
          { marginTop: group.isFirstInGroup ? 8 : 2 },
        ]}
      >
        <View
          style={[styles.albumWrap, mine ? styles.alignEnd : styles.alignStart]}
        >
          <View
            style={{
              borderRadius: 16,
              height: albumHeight,
              overflow: "hidden",
              width: albumWidth,
            }}
          >
            {images.map((image, index) => {
              const frame = albumTileFrames(layout, {
                height: albumHeight,
                width: albumWidth,
              })[index];
              if (!frame) {
                return null;
              }
              return (
                <Pressable
                  accessibilityLabel="Open image"
                  key={`${image.url}-${index}`}
                  onPress={() => onPressImage?.(index)}
                  style={[
                    styles.albumTile,
                    {
                      height: frame.height,
                      left: frame.x,
                      top: frame.y,
                      width: frame.width,
                    },
                  ]}
                >
                  <MessageImage
                    cachePolicy={ephemeral ? "none" : undefined}
                    contentFit={images.length === 1 ? "contain" : "cover"}
                    source={mediaUrl(image.url)}
                    style={StyleSheet.absoluteFill}
                  />
                </Pressable>
              );
            })}
            <MessageSearchHighlight jump={searchJump} />
          </View>
          {payload.content ? (
            <Text
              style={[
                styles.mediaCaption,
                { color: mine ? "#ffffff" : undefined },
              ]}
            >
              {payload.content}
            </Text>
          ) : null}
          <ReactionPills
            disabled={reactionPending}
            mine={mine}
            onReact={onReact}
            reactions={reactions}
          />
        </View>
        {showReceipt && mine && receipt ? (
          <ReceiptLine
            at={formatReceiptStamp(receipt.at)}
            label={receipt.status}
          />
        ) : null}
      </View>
    );
  }

  if (payload.type === "post") {
    return (
      <View
        style={[
          styles.row,
          mine ? styles.rowMine : styles.rowTheirs,
          { marginTop: group.isFirstInGroup ? 8 : 2 },
        ]}
      >
        <View style={{ maxWidth: bubbleWidth }}>
          <SentOrReceived
            searchJump={searchJump}
            corners={corners}
            maxWidth={bubbleWidth}
            mine={mine}
            theme={theme}
          >
            {payload.content?.trim() ? (
              <Text style={styles.sharedLabel}>{payload.content.trim()}</Text>
            ) : null}
            <MessagePostPreview key={payload.postId} postId={payload.postId} />
          </SentOrReceived>
          <ReactionPills
            disabled={reactionPending}
            mine={mine}
            onReact={onReact}
            reactions={reactions}
          />
        </View>
        {showReceipt && mine && receipt ? (
          <ReceiptLine
            at={formatReceiptStamp(receipt.at)}
            label={receipt.status}
          />
        ) : null}
      </View>
    );
  }

  return (
    <View
      style={[
        styles.row,
        mine ? styles.rowMine : styles.rowTheirs,
        { marginTop: group.isFirstInGroup ? 8 : 2 },
      ]}
    >
      {!mine && group.isLastInGroup ? (
        <View
          style={[styles.peerAvatar, reactions.length > 0 && { bottom: 21 }]}
        >
          <UserAvatar size={28} url={peerAvatarUrl ?? null} />
        </View>
      ) : null}
      <View style={{ maxWidth: bubbleWidth }}>
        <SentOrReceived
          searchJump={searchJump}
          corners={corners}
          maxWidth={bubbleWidth}
          mine={mine}
          theme={theme}
        >
          {replyPreview ? (
            <View
              style={[
                styles.quote,
                mine ? styles.quoteMine : styles.quoteTheirs,
              ]}
            >
              <View
                style={[
                  styles.quoteBar,
                  { backgroundColor: mine ? "#ffffff88" : "#8e8e9380" },
                ]}
              />
              <Text
                numberOfLines={2}
                style={[styles.quoteText, mine && styles.quoteTextMine]}
              >
                {replyPreview.text}
              </Text>
            </View>
          ) : null}
          <Text
            style={[
              mine ? styles.textMine : styles.textTheirs,
              !mine && { color: isDark ? "#eeeeee" : "#202020" },
            ]}
          >
            {payload.content}
          </Text>
          {edited ? (
            <Text style={[styles.edited, mine && styles.editedMine]}>
              edited
            </Text>
          ) : null}
        </SentOrReceived>
        <ReactionPills
          disabled={reactionPending}
          mine={mine}
          onReact={onReact}
          reactions={reactions}
        />
      </View>
      {showReceipt && mine && receipt ? (
        <ReceiptLine
          at={formatReceiptStamp(receipt.at)}
          label={receipt.status}
        />
      ) : null}
    </View>
  );
}

function ReactionPills({
  disabled = false,
  onReact,
  reactions,
}: {
  mine: boolean;
  disabled?: boolean;
  onReact?: (emoji: string) => void;
  reactions: MessageReactionSummary[];
}) {
  const { theme } = useAppTheme();
  if (!onReact || reactions.length === 0) {
    return null;
  }
  const reactionWidth = Math.min(
    240,
    reactions.reduce(
      (width, reaction) =>
        width +
        34 +
        (reaction.count > 1 ? 8 + String(reaction.count).length * 7 : 0),
      0
    )
  );
  return (
    <ScrollView
      contentContainerStyle={{
        flexGrow: 1,
        gap: 3,
        justifyContent: "flex-end",
      }}
      horizontal
      showsHorizontalScrollIndicator={false}
      style={[styles.reactionRow, { width: reactionWidth }]}
    >
      {reactions.map((reaction) => (
        <Pressable
          accessibilityLabel={`${reaction.emoji}, ${reaction.count} reactions${reaction.reactedByMe ? ", selected" : ""}`}
          accessibilityRole="button"
          accessibilityState={{ selected: reaction.reactedByMe }}
          key={reaction.emoji}
          disabled={disabled}
          hitSlop={6}
          onPress={() => onReact(reaction.emoji)}
          style={[
            styles.reactionChip,
            { backgroundColor: theme.cardBg, borderColor: theme.cardBorder },
            reaction.reactedByMe && styles.reactionChipSelected,
          ]}
        >
          <Text style={[styles.reactionText, { color: theme.inputText }]}>
            {reaction.emoji}
            {reaction.count > 1 ? ` ${reaction.count}` : ""}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

function albumWidthForBubble(bubbleWidth: number): number {
  return Math.min(ALBUM_MAX_WIDTH, bubbleWidth);
}

function MessageVideoAttachment({ url }: { url: string }) {
  const { mediaCookie, userId } = useMessagesIdentity();
  const request = messageImageSource(url, getApiBaseUrl(), userId, mediaCookie);
  const player = useVideoPlayer(
    request.source
      ? {
          headers: request.source.headers,
          uri: request.source.uri,
          useCaching: false,
        }
      : null
  );
  return (
    <VideoView
      contentFit="contain"
      nativeControls
      player={player}
      style={styles.videoAttachment}
    />
  );
}

function MessageFileAttachment({
  attachment,
  mine,
}: {
  attachment: Extract<
    ReturnType<typeof getMediaAttachments>[number],
    { kind: "file" }
  >;
  mine: boolean;
}) {
  const { isDark } = useAppTheme();
  const [busy, setBusy] = useState(false);
  const openFile = useCallback(async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      await downloadAndShareMessageFile(attachment.url, attachment.filename);
    } catch (error) {
      toast({
        description:
          error instanceof Error ? error.message : "Please try again.",
        title: "Couldn't open file",
        variant: "destructive",
      });
    }
    setBusy(false);
  }, [attachment.filename, attachment.url, busy]);
  return (
    <Pressable
      accessibilityLabel={`Open ${attachment.filename}`}
      accessibilityRole="button"
      disabled={busy}
      onPress={openFile}
      style={styles.fileCard}
    >
      <View style={styles.fileIcon}>
        <FileText color="#85858b" size={20} />
      </View>
      <View style={styles.fileTextWrap}>
        <Text
          numberOfLines={1}
          style={[
            styles.fileName,
            { color: mine || isDark ? "#ffffff" : "#2a2a2a" },
          ]}
        >
          {attachment.filename}
        </Text>
        <Text style={styles.fileSize}>
          {formatMessageFileSize(attachment.bytes)}
        </Text>
      </View>
      <Download color="#85858b" size={17} />
    </Pressable>
  );
}

async function downloadAndShareMessageFile(
  messageMediaUrl: string,
  filename: string
): Promise<void> {
  const mediaId = /^\/api\/media\/(?<id>[A-Za-z0-9_-]+)(?:\/|$)/u.exec(
    messageMediaUrl
  )?.groups?.id;
  if (!mediaId) {
    throw new Error("This file is unavailable.");
  }
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("File sharing is unavailable on this device.");
  }
  const directory = new Directory(Paths.cache, "message-attachments");
  directory.create({ idempotent: true, intermediates: true });
  const safeName = filename.replaceAll(/[^A-Za-z0-9._-]/g, "_").slice(0, 100);
  const file = new File(directory, `${Date.now()}-${safeName || "attachment"}`);
  const cookie = await authClient.getCookie();
  await File.downloadFileAsync(
    `${getApiBaseUrl()}/api/media/download/${mediaId}`,
    file,
    {
      headers: cookie ? { Cookie: cookie } : undefined,
      idempotent: true,
    }
  );
  await Sharing.shareAsync(file.uri, {
    dialogTitle: filename,
    mimeType: "application/octet-stream",
  });
}

function formatMessageFileSize(bytes?: number): string {
  if (!bytes || bytes <= 0) {
    return "File";
  }
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ReadyMessageBubble(props: MessageBubbleProps) {
  const { entrances, messageId } = props;
  // oxlint-disable-next-line react/hook-use-state -- Snapshot once per mount; consuming eligibility must not change this rendered entrance.
  const [entering] = useState(() =>
    messageId ? (entrances?.isPending(messageId) ?? false) : false
  );
  useLayoutEffect(() => {
    if (messageId) {
      entrances?.consume(messageId);
    }
  }, [entrances, messageId]);
  const bubble = <MessageBubbleInner {...props} />;
  return entering ? (
    <MessageBubbleEntrance
      mine={props.mine}
      media={props.payload?.type !== "text"}
    >
      {bubble}
    </MessageBubbleEntrance>
  ) : (
    bubble
  );
}

function MessageBubbleWithEntrance(props: MessageBubbleProps) {
  return props.payload && !props.deleted && !props.failed ? (
    <ReadyMessageBubble key={props.messageId} {...props} />
  ) : (
    <MessageBubbleInner {...props} />
  );
}

// Memoized because a transcript re-renders as each decrypted row lands; without it
// a 30-row page would re-render all 30 bubbles for every row that arrives.
export const MessageBubble = memo(MessageBubbleWithEntrance);
MessageBubble.displayName = "MessageBubble";

/**
 * The bubble box. A sent bubble is a theme gradient with the dual border from
 * `.bubble-sent`; a received bubble is the neutral recipe. Both are drawn with the
 * gradient as an absolute child, because RN paints an inset shadow over the
 * element's own background and a gradient child would erase the lip.
 */
function SentOrReceived({
  searchJump,
  children,
  corners,
  maxWidth,
  mine,
  theme,
}: {
  searchJump: number;
  children: React.ReactNode;
  corners: BubbleCorners;
  maxWidth: number;
  mine: boolean;
  theme: ConversationTheme;
}) {
  if (!mine) {
    return (
      <ReceivedBubbleSurface
        corners={corners}
        style={{ maxWidth, overflow: "hidden" }}
      >
        {children}
        <MessageSearchHighlight jump={searchJump} />
      </ReceivedBubbleSurface>
    );
  }
  return (
    // Gradient3D rather than a View plus a gradient child: the `.bubble-sent`
    // recipe's bright inner lip is an inset shadow, which RN paints on the
    // element's own background, so a gradient child would erase it and the
    // dual border would collapse to one ring.
    <Gradient3D
      borderRadius={corners}
      colors={bubbleSentStops(theme.from, theme.to)}
      shadows={sentBubbleShadows(theme)}
      style={[styles.bubbleMine, { maxWidth, overflow: "hidden" }]}
    >
      <View style={styles.bubbleContent}>{children}</View>
      <MessageSearchHighlight jump={searchJump} />
    </Gradient3D>
  );
}

// A fixed-height placeholder while the row decrypts. Sized like a one-line bubble
// rather than collapsed to nothing, so the transcript does not jump when the text
// arrives.
function PendingBubble({ mine, width }: { mine: boolean; width: number }) {
  const { isDark } = useAppTheme();
  const panel = panel3d(isDark);
  return (
    <View
      style={[
        styles.pending,
        mine ? styles.alignEnd : styles.alignStart,
        {
          backgroundColor: panel.background,
          boxShadow: panel.shadows,
          width,
        },
      ]}
    >
      <View
        style={[
          styles.pendingLine,
          { backgroundColor: isDark ? "#3a3a3a" : "#d9d9d9" },
        ]}
      />
      <View
        style={[
          styles.pendingLineShort,
          { backgroundColor: isDark ? "#333333" : "#e2e2e2" },
        ]}
      />
    </View>
  );
}

// The row a message's reply points at. A reserved bar plus two lines of clamped
// text; when the referenced message is not loaded the shape stays, so a bubble
// never changes height because a reply became resolvable.
export function ReplyQuote({ mine, text }: { mine: boolean; text: string }) {
  return (
    <View style={[styles.quote, mine ? styles.quoteMine : styles.quoteTheirs]}>
      <View
        style={[
          styles.quoteBar,
          { backgroundColor: mine ? "#ffffff88" : "#8e8e9380" },
        ]}
      />
      <Text
        numberOfLines={2}
        style={[styles.quoteText, mine && styles.quoteTextMine]}
      >
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  albumTile: {
    overflow: "hidden",
    position: "absolute",
  },
  albumWrap: {
    maxWidth: "100%",
  },
  alignEnd: {
    alignItems: "flex-end",
  },
  alignStart: {
    alignItems: "flex-start",
  },
  attachmentList: {
    alignItems: "stretch",
    gap: 8,
    width: "100%",
  },
  bubbleContent: {
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  bubbleMine: {
    borderRadius: 16,
  },
  edited: {
    fontFamily: "SofiaProReg",
    fontSize: 10,
    fontStyle: "italic",
    marginTop: 2,
    opacity: 0.7,
  },
  editedMine: {
    color: "#ffffffcc",
  },
  failedText: {
    color: "#8e8e93",
    fontFamily: "SofiaProReg",
    fontSize: 14,
    fontStyle: "italic",
  },
  fileCard: {
    alignItems: "center",
    backgroundColor: "rgba(127, 127, 127, 0.10)",
    borderColor: "rgba(127, 127, 127, 0.18)",
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 11,
    minHeight: 62,
    paddingHorizontal: 12,
    paddingVertical: 9,
    width: "100%",
  },
  fileIcon: {
    alignItems: "center",
    backgroundColor: "rgba(127, 127, 127, 0.12)",
    borderRadius: 10,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  fileName: {
    color: "#2a2a2a",
    flexShrink: 1,
    fontFamily: "SofiaProMed",
    fontSize: 13,
  },
  fileSize: {
    color: "#7b7b80",
    fontFamily: "SofiaProReg",
    fontSize: 11,
    marginTop: 2,
  },
  fileTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  mediaCaption: {
    color: "#8e8e93",
    fontFamily: "SofiaProReg",
    fontSize: 14,
    marginTop: 4,
  },
  mixedImageFrame: {
    aspectRatio: 1.25,
    backgroundColor: "rgba(0,0,0,0.08)",
    borderRadius: 14,
    overflow: "hidden",
    width: "100%",
  },
  peerAvatar: {
    bottom: 0,
    left: 16,
    position: "absolute",
  },
  pending: {
    borderRadius: 16,
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  pendingLine: {
    borderRadius: 4,
    height: 10,
    width: "100%",
  },
  pendingLineShort: {
    borderRadius: 4,
    height: 10,
    width: "60%",
  },
  quote: {
    borderRadius: 8,
    flexDirection: "row",
    gap: 8,
    marginBottom: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  quoteBar: {
    borderRadius: 2,
    width: 3,
  },
  quoteMine: {
    backgroundColor: "#00000033",
  },
  quoteText: {
    color: "#646464",
    flexShrink: 1,
    fontFamily: "SofiaProReg",
    fontSize: 12,
  },
  quoteTextMine: {
    color: "#ffffffe0",
  },
  quoteTheirs: {
    backgroundColor: "#8e8e931f",
  },
  reactionChip: {
    alignItems: "center",
    backgroundColor: "rgba(127, 127, 127, 0.10)",
    borderColor: "rgba(127, 127, 127, 0.24)",
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: "center",
    minHeight: 30,
    paddingHorizontal: 8,
  },
  reactionChipSelected: {
    backgroundColor: "rgba(88, 140, 220, 0.18)",
    borderColor: "rgba(88, 140, 220, 0.6)",
  },
  reactionRow: {
    alignSelf: "flex-end",
    flexGrow: 0,
    height: 32,
    marginRight: 4,
    marginTop: -9,
    maxWidth: "100%",
    zIndex: 1,
  },
  reactionText: {
    color: "#85858b",
    fontFamily: "SofiaProMed",
    fontSize: 12,
  },
  retry: {
    color: "#f66b15",
    fontFamily: "SofiaProMed",
    fontSize: 13,
    marginTop: 4,
  },
  row: {
    flexDirection: "column",
    paddingHorizontal: 16,
  },
  rowMine: {
    alignItems: "flex-end",
  },
  rowTheirs: {
    alignItems: "flex-start",
    paddingLeft: 52,
  },
  sharedLabel: {
    color: "#646464",
    fontFamily: "SofiaProReg",
    fontSize: 14,
  },
  textMine: {
    color: "#ffffff",
    fontFamily: "SofiaProReg",
    fontSize: 14,
  },
  textTheirs: {
    color: "#202020",
    fontFamily: "SofiaProReg",
    fontSize: 14,
  },
  videoAttachment: {
    aspectRatio: 16 / 9,
    backgroundColor: "#000",
    borderRadius: 14,
    overflow: "hidden",
    width: "100%",
  },
  viewOnceCard: {
    minHeight: 66,
  },
  viewOnceClose: {
    alignItems: "center",
    backgroundColor: "#00000099",
    borderRadius: 9999,
    height: 40,
    justifyContent: "center",
    position: "absolute",
    right: 16,
    width: 40,
  },
  viewOnceCopy: {
    flex: 1,
    minWidth: 0,
  },
  viewOnceError: {
    color: "#c2410c",
    fontFamily: "SofiaProReg",
    fontSize: 11,
    marginTop: 2,
  },
  viewOnceImage: {
    height: "100%",
    width: "100%",
  },
  viewOnceModal: {
    alignItems: "center",
    backgroundColor: "#000000",
    bottom: 0,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  viewOnceOpen: {
    color: "#8a8a8f",
    fontFamily: "SofiaProMed",
    fontSize: 11,
  },
});
