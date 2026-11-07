// Native port of web's CommunityChatMessageActions
// (apps/web/src/components/communities/page/community-chat-message-actions.tsx).
// Web renders a dropdown anchored to the message row; native renders the same
// items inside the message-actions DialogPanel (bottom-sheet adaptation):
// quick reactions, Reply, Start a thread, Copy message link, Pin/Unpin
// (staff), Edit (own), Delete (own or staff). Same gating props as web.
import type { CommunityChatMessage } from "@asm/messages";
import { QUICK_MESSAGE_REACTIONS } from "@asm/messages";
import {
  Link2,
  MessageCircle,
  Pencil,
  Pin,
  Reply,
  Trash2,
} from "lucide-react-native";
import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useAppTheme } from "@/theme";

export interface CommunityChatMessageActionGating {
  canManage: boolean;
  canSend: boolean;
  hasThread: boolean;
  isOwn: boolean;
  pinned: boolean;
  threadId: string | null;
}

function CommunityChatMessageActions({
  accent,
  gating,
  message,
  onCopyLink,
  onDelete,
  onEdit,
  onPin,
  onReact,
  onReply,
  onStartThread,
}: {
  accent: string;
  gating: CommunityChatMessageActionGating;
  message: CommunityChatMessage;
  onCopyLink: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onPin: () => void;
  onReact: (emoji: string) => void;
  onReply: () => void;
  onStartThread: () => void;
}) {
  const { theme } = useAppTheme();
  if (!gating.canSend) {
    return (
      <Text style={[styles.note, { color: theme.dividerText }]}>
        Join this community to reply or react.
      </Text>
    );
  }
  return (
    <>
      <View style={styles.reactions}>
        {QUICK_MESSAGE_REACTIONS.map((emoji) => (
          <Pressable
            accessibilityLabel={`React ${emoji}`}
            accessibilityRole="button"
            key={emoji}
            onPress={() => onReact(emoji)}
            style={styles.reaction}
          >
            <Text style={styles.reactionEmoji}>{emoji}</Text>
          </Pressable>
        ))}
      </View>
      <ActionRow
        icon={<Reply color={accent} size={18} />}
        label="Reply"
        onPress={onReply}
      />
      {!gating.threadId && !gating.hasThread ? (
        <ActionRow
          icon={<MessageCircle color={accent} size={18} />}
          label="Start a thread"
          onPress={onStartThread}
        />
      ) : null}
      <ActionRow
        icon={<Link2 color={accent} size={18} />}
        label="Copy message link"
        messageId={message.id}
        onPress={onCopyLink}
      />
      {gating.canManage ? (
        <ActionRow
          icon={<Pin color={accent} size={18} />}
          label={gating.pinned ? "Unpin message" : "Pin message"}
          onPress={onPin}
        />
      ) : null}
      {gating.isOwn ? (
        <ActionRow
          icon={<Pencil color={accent} size={18} />}
          label="Edit message"
          onPress={onEdit}
        />
      ) : null}
      {gating.isOwn || gating.canManage ? (
        <ActionRow
          destructive
          icon={<Trash2 color={theme.errorBannerText} size={18} />}
          label="Delete message"
          onPress={onDelete}
        />
      ) : null}
    </>
  );
}

function ActionRow({
  destructive,
  icon,
  label,
  messageId,
  onPress,
}: {
  destructive?: boolean;
  icon: React.ReactNode;
  label: string;
  messageId?: string;
  onPress: () => void;
}) {
  const { theme } = useAppTheme();
  return (
    <Pressable
      accessibilityLabel={messageId ? `${label}, ${messageId}` : label}
      accessibilityRole="button"
      onPress={onPress}
      style={styles.actionRow}
    >
      {icon}
      <Text
        style={[
          styles.actionLabel,
          { color: destructive ? theme.errorBannerText : theme.inputText },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  actionLabel: { fontFamily: "SofiaProBold", fontSize: 15 },
  actionRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    minHeight: 48,
    paddingVertical: 10,
  },
  note: { fontFamily: "SofiaProReg", fontSize: 12 },
  reaction: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
    minWidth: 44,
  },
  reactionEmoji: { fontSize: 26 },
  reactions: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 12,
  },
});

export default memo(CommunityChatMessageActions);
