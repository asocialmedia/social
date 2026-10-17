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

import { File, Directory, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { VideoView, useVideoPlayer } from "expo-video";
import { Download, FileText, LockKeyhole } from "lucide-react-native";
import { memo, useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { UserAvatar } from "@/components/avatar/user-avatar";
import { toast } from "@/components/feedback/toast";
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
import type { MessageReceiptInfo } from "@/features/messages/lib/message-receipts";
import {
  bubbleSentStops,
  panel3d,
} from "@/features/messages/lib/message-recipes";
import { getApiBaseUrl } from "@/lib/api-env";
import { useAppTheme } from "@/theme";

import { MessagePostPreview } from "./message-post-preview";
import { MessageSearchHighlight } from "./message-search-highlight";
import {
  DeletedBubble,
  MessageImage,
  ReceivedBubbleSurface,
  ReceiptLine,
  mediaUrl,
} from "./messages-primitives";

// The album's rendered width. Web caps the collage at 384px; on a phone the bubble
// itself is the cap, and this is the ceiling inside it.
const ALBUM_MAX_WIDTH = 384;
const MAX_BUBBLE_WIDTH_RATIO = 0.85;

export interface MessageBubbleProps {
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
  ephemeral = false,
  searchJump = 0,
  deleted,
  edited,
  failed,
  group,
  maxBubbleWidth,
  mine,
  onPressImage,
  onRetry,
  peerAvatarUrl,
  payload,
  receipt,
  replyPreview,
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
              return (
                <View key={`view-once-${index}`} style={styles.fileCard}>
                  <LockKeyhole color="#9a9a9a" size={20} />
                  <Text style={styles.fileName}>View once photo</Text>
                </View>
              );
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
        <View style={styles.peerAvatar}>
          <UserAvatar size={28} url={peerAvatarUrl ?? null} />
        </View>
      ) : null}
      <SentOrReceived
        searchJump={searchJump}
        corners={corners}
        maxWidth={bubbleWidth}
        mine={mine}
        theme={theme}
      >
        {replyPreview ? (
          <View
            style={[styles.quote, mine ? styles.quoteMine : styles.quoteTheirs]}
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
          <Text style={[styles.edited, mine && styles.editedMine]}>edited</Text>
        ) : null}
      </SentOrReceived>
      {showReceipt && mine && receipt ? (
        <ReceiptLine
          at={formatReceiptStamp(receipt.at)}
          label={receipt.status}
        />
      ) : null}
    </View>
  );
}

function albumWidthForBubble(bubbleWidth: number): number {
  return Math.min(ALBUM_MAX_WIDTH, bubbleWidth);
}

function MessageVideoAttachment({ url }: { url: string }) {
  const player = useVideoPlayer(url);
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

// Memoized because a transcript re-renders as each decrypted row lands; without it
// a 30-row page would re-render all 30 bubbles for every row that arrives.
export const MessageBubble = memo(MessageBubbleInner);
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
});
