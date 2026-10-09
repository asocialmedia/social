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

import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { UserAvatar } from "@/components/avatar/user-avatar";
import { Gradient3D } from "@/components/surface/gradient-3d";
import { sentBubbleShadows } from "@/features/messages/lib/conversation-theme";
import type { ConversationTheme } from "@/features/messages/lib/conversation-theme";
import type { MessagePayload } from "@/features/messages/lib/crypto";
import { getMediaImages } from "@/features/messages/lib/crypto";
import {
  albumHeightForWidth,
  albumTileFrames,
  getAlbumLayout,
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
import { useAppTheme } from "@/theme";

import {
  DeletedBubble,
  MessageImage,
  ReceivedBubbleSurface,
  ReceiptLine,
  mediaUrl,
} from "./messages-primitives";

// The album's rendered width. Web caps the collage at 384px; on a phone the bubble
// itself is the cap, and this is the ceiling inside it.
const ALBUM_MAX_WIDTH = 260;
const MAX_BUBBLE_WIDTH_RATIO = 0.85;

export interface MessageBubbleProps {
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
        <DeletedBubble mine={mine} />
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
    const images = getMediaImages(payload);
    const layout = getAlbumLayout(images.length);
    const albumWidth = Math.min(ALBUM_MAX_WIDTH, bubbleWidth);
    const albumHeight = albumHeightForWidth(layout, albumWidth);
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
                    source={mediaUrl(image.url)}
                    style={StyleSheet.absoluteFill}
                  />
                </Pressable>
              );
            })}
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
          corners={corners}
          maxWidth={bubbleWidth}
          mine={mine}
          theme={theme}
        >
          <Text style={styles.sharedLabel}>
            {payload.content?.trim() || "Shared a post"}
          </Text>
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
  children,
  corners,
  maxWidth,
  mine,
  theme,
}: {
  children: React.ReactNode;
  corners: BubbleCorners;
  maxWidth: number;
  mine: boolean;
  theme: ConversationTheme;
}) {
  if (!mine) {
    return (
      <ReceivedBubbleSurface corners={corners} style={{ maxWidth }}>
        {children}
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
      style={[styles.bubbleMine, { maxWidth }]}
    >
      <View style={styles.bubbleContent}>{children}</View>
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
  mediaCaption: {
    color: "#8e8e93",
    fontFamily: "SofiaProReg",
    fontSize: 14,
    marginTop: 4,
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
    flex: 1,
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
});
