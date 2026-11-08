// One community chat message row, memoized so a newly arrived message does
// not re-render every mounted row (audit P1-1). The timeline screen passes
// stable callbacks; the row only re-renders when its own message changes.
import type { CommunityChatMessage } from "@asm/messages";
import { isStickerMessagePayload } from "@asm/messages/payload";
import { Image } from "expo-image";
import { MoreHorizontal } from "lucide-react-native";
import { memo } from "react";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { UserBadge } from "@/features/home/components/user-badge";
import { SavableSticker } from "@/features/messages/components/savable-sticker";

import type { CommunityDetail } from "../lib/communities-api";

function userLabel(message: CommunityChatMessage): string {
  return message.sender.displayName.trim() || message.sender.username;
}

function CommunityChatMessageRow({
  accent,
  apiBase,
  canReact,
  cardBg,
  cardBorder,
  community,
  dividerText,
  grouped,
  hasThread,
  inputText,
  message,
  onOpenActions,
  onOpenThread,
  onReact,
  showThreadLink,
}: {
  accent: string;
  apiBase: string;
  canReact: boolean;
  cardBg: string;
  cardBorder: string;
  community: CommunityDetail["community"] | null;
  dividerText: string;
  grouped: boolean;
  hasThread: boolean;
  inputText: string;
  message: CommunityChatMessage;
  onOpenActions: (message: CommunityChatMessage) => void;
  onOpenThread: (message: CommunityChatMessage) => void;
  onReact: (message: CommunityChatMessage, emoji: string) => void;
  showThreadLink: boolean;
}) {
  let body: ReactNode = null;
  if (message.payload?.type === "text") {
    body = (
      <Text style={[styles.messageText, { color: inputText }]}>
        {message.payload.content}
      </Text>
    );
  } else if (message.payload && isStickerMessagePayload(message.payload)) {
    body = (
      <SavableSticker
        canSave
        mediaId={message.payload.sticker.mediaId}
        messageId={message.id}
        source="community"
      >
        <Image
          source={{
            uri: `${apiBase}/api/communities/chat/stickers/${message.id}`,
          }}
          contentFit="contain"
          style={{ height: 192, width: 192 }}
        />
      </SavableSticker>
    );
  } else if (message.deletedAt) {
    body = (
      <Text style={[styles.deletedText, { color: dividerText }]}>
        This message was deleted.
      </Text>
    );
  }
  return (
    <Pressable
      accessible={false}
      onLongPress={() => {
        if (!message.deletedAt) {
          onOpenActions(message);
        }
      }}
      style={[styles.messageRow, grouped && styles.groupedMessage]}
    >
      <View style={styles.messageAvatarSlot}>
        {grouped ? null : (
          <Image
            source={
              message.sender.avatarUrl
                ? { uri: message.sender.avatarUrl }
                : undefined
            }
            style={[
              styles.avatar,
              { backgroundColor: cardBg, borderColor: cardBorder },
            ]}
          />
        )}
      </View>
      <View style={[styles.messageBody, grouped && { paddingRight: 36 }]}>
        {grouped ? null : (
          <View style={styles.messageMeta}>
            <Text
              numberOfLines={1}
              style={[styles.senderName, { color: inputText }]}
            >
              {userLabel(message)}
            </Text>
            {message.sender.role && community ? (
              <UserBadge
                communityRoles={[{ community, role: message.sender.role }]}
              />
            ) : null}
            <Text style={[styles.timestamp, { color: dividerText }]}>
              {new Date(message.createdAt).toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
              })}
            </Text>
            {message.editedAt ? (
              <Text style={[styles.timestamp, { color: dividerText }]}>
                edited
              </Text>
            ) : null}
          </View>
        )}
        {message.replyTo ? (
          <Text
            numberOfLines={1}
            style={[styles.channelTopic, { color: dividerText }]}
          >
            ↳ {message.replyTo.senderName}:{" "}
            {message.replyTo.deleted
              ? "Original message deleted"
              : (message.replyTo.content ?? "Message")}
          </Text>
        ) : null}
        {message.pinned ? (
          <Text style={[styles.staffLabel, { color: accent }]}>
            PINNED MESSAGE
          </Text>
        ) : null}
        {body}
        {message.reactions?.length ? (
          <View style={[styles.row, { flexWrap: "wrap", marginTop: 6 }]}>
            {message.reactions.map((reaction) => (
              <Pressable
                accessibilityLabel={`${reaction.emoji}, ${reaction.count} reactions`}
                accessibilityRole="button"
                accessibilityState={{
                  disabled: !canReact,
                  selected: reaction.reacted,
                }}
                disabled={!canReact}
                key={reaction.emoji}
                onPress={() => onReact(message, reaction.emoji)}
                style={{
                  backgroundColor: reaction.reacted ? `${accent}20` : cardBg,
                  borderColor: reaction.reacted ? accent : cardBorder,
                  borderRadius: 18,
                  borderWidth: StyleSheet.hairlineWidth,
                  minHeight: 34,
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                }}
              >
                <Text style={{ color: inputText }}>
                  {reaction.emoji} {reaction.count}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        {showThreadLink && hasThread ? (
          <Pressable
            onPress={() => onOpenThread(message)}
            style={{ paddingVertical: 8 }}
          >
            <Text style={[styles.retryAction, { color: accent }]}>
              View thread →
            </Text>
          </Pressable>
        ) : null}
        {message.deletedAt ? null : (
          <Pressable
            accessibilityLabel="Message actions"
            accessibilityRole="button"
            hitSlop={6}
            onPress={() => onOpenActions(message)}
            style={{
              alignItems: "center",
              justifyContent: "center",
              minHeight: 36,
              minWidth: 36,
              position: "absolute",
              right: 0,
              top: 0,
            }}
          >
            <MoreHorizontal color={dividerText} size={18} />
          </Pressable>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  avatar: {
    borderRadius: 15,
    borderWidth: StyleSheet.hairlineWidth,
    height: 34,
    width: 34,
  },
  channelTopic: { fontFamily: "SofiaProReg", fontSize: 12, marginTop: 3 },
  deletedText: { fontFamily: "SofiaProReg", fontSize: 13, fontStyle: "italic" },
  groupedMessage: { paddingTop: 2 },
  messageAvatarSlot: { alignItems: "center", paddingTop: 2, width: 36 },
  messageBody: { flex: 1, gap: 3, minWidth: 0 },
  messageMeta: {
    alignItems: "baseline",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
    paddingRight: 36,
  },
  messageRow: {
    flexDirection: "row",
    gap: 9,
    paddingBottom: 7,
    paddingTop: 9,
  },
  messageText: { fontFamily: "SofiaProReg", fontSize: 15, lineHeight: 22 },
  retryAction: { fontFamily: "SofiaProBold", fontSize: 12 },
  row: { alignItems: "center", flexDirection: "row", gap: 8 },
  senderName: { fontFamily: "SofiaProBold", fontSize: 13, maxWidth: "70%" },
  staffLabel: { fontFamily: "SofiaProBold", fontSize: 9, letterSpacing: 0.7 },
  timestamp: { fontFamily: "SofiaProReg", fontSize: 10 },
});

export default memo(CommunityChatMessageRow);
