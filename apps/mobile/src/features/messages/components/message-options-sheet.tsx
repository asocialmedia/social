// Per-message options, ported from
// apps/web/src/components/messages/message-options-menu.tsx. Web renders a
// positioned popover; here the content lives in the shared MessageSheet bottom
// sheet (a Drawer has no native equivalent), but the rows keep web's order,
// copy and gating: details (Sent/Edited/receipt), the inline quick-reaction
// row with a More-reactions opener, then Copy, Reply, Edit (owner + window),
// Select, Forward (text and post payloads only), Delete for me, Delete for
// everyone (owner + live). Forward is the native entry to the share picker:
// web's picker is only reached from a post, while a message's Forward row
// carries the decrypted payload to the chosen conversation.
import { QUICK_MESSAGE_REACTIONS } from "@asm/messages";
import {
  Check,
  Copy,
  Forward,
  MessageSquareQuote,
  Pencil,
  Plus,
  Trash,
  Trash2,
} from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useAppTheme } from "@/theme";

import { formatMessageDateTime } from "../lib/message-datetime";
import type { MessageReceiptInfo } from "../lib/message-receipts";
import { receiptLabel } from "../lib/message-receipts";

export interface MessageOptionsSheetProps {
  canDeleteForEveryone: boolean;
  canEdit: boolean;
  canForward: boolean;
  createdAt: Date | string;
  editedAt?: Date | string | null;
  receipt: MessageReceiptInfo | null;
  reactionPending: boolean;
  onCopy: () => void;
  onDeleteEveryone: () => void;
  onDeleteMe: () => void;
  onEdit: () => void;
  onForward: () => void;
  onMoreReactions: () => void;
  onReact: (emoji: string) => void;
  onReply: () => void;
  onSelect: () => void;
}

export function MessageOptionsSheet(props: MessageOptionsSheetProps) {
  const { theme } = useAppTheme();
  const sentLabel = formatMessageDateTime(props.createdAt);
  const editedLabel = props.editedAt
    ? formatMessageDateTime(props.editedAt)
    : "";
  const receiptText = props.receipt
    ? (() => {
        const at = props.receipt.at
          ? formatMessageDateTime(props.receipt.at)
          : "";
        return at
          ? `${receiptLabel(props.receipt.status)} · ${at}`
          : receiptLabel(props.receipt.status);
      })()
    : "";
  const muted = theme.dividerText;
  const ink = theme.inputText;
  return (
    <View>
      {sentLabel || editedLabel || receiptText ? (
        <View style={styles.details}>
          {sentLabel ? (
            <Text style={[styles.detail, { color: muted }]}>
              Sent <Text style={{ color: ink }}>{sentLabel}</Text>
            </Text>
          ) : null}
          {editedLabel ? (
            <Text style={[styles.detail, { color: muted }]}>
              Edited <Text style={{ color: ink }}>{editedLabel}</Text>
            </Text>
          ) : null}
          {receiptText ? (
            <Text style={[styles.detail, { color: muted }]}>{receiptText}</Text>
          ) : null}
        </View>
      ) : null}
      <View
        accessibilityLabel="Choose a reaction"
        accessibilityRole="radiogroup"
        style={styles.reactions}
      >
        {QUICK_MESSAGE_REACTIONS.map((emoji) => (
          <Pressable
            accessibilityLabel={`React with ${emoji}`}
            accessibilityRole="button"
            disabled={props.reactionPending}
            key={emoji}
            onPress={() => props.onReact(emoji)}
            style={styles.reaction}
          >
            <Text style={styles.emoji}>{emoji}</Text>
          </Pressable>
        ))}
        <Pressable
          accessibilityLabel="More reactions"
          accessibilityRole="button"
          onPress={props.onMoreReactions}
          style={styles.reaction}
        >
          <View style={[styles.more, { borderColor: muted }]}>
            <Plus color={muted} size={18} />
          </View>
        </Pressable>
      </View>
      <OptionRow
        destructive={false}
        icon={<Copy color={ink} size={19} />}
        label="Copy"
        onPress={props.onCopy}
      />
      <OptionRow
        destructive={false}
        icon={<MessageSquareQuote color={ink} size={19} />}
        label="Reply"
        onPress={props.onReply}
      />
      {props.canEdit ? (
        <OptionRow
          destructive={false}
          icon={<Pencil color={ink} size={19} />}
          label="Edit"
          onPress={props.onEdit}
        />
      ) : null}
      <OptionRow
        destructive={false}
        icon={<Check color={ink} size={19} />}
        label="Select"
        onPress={props.onSelect}
      />
      {props.canForward ? (
        <OptionRow
          destructive={false}
          icon={<Forward color={ink} size={19} />}
          label="Forward"
          onPress={props.onForward}
        />
      ) : null}
      <OptionRow
        destructive
        icon={<Trash2 color="#ff3b30" size={19} />}
        label="Delete for me"
        onPress={props.onDeleteMe}
      />
      {props.canDeleteForEveryone ? (
        <OptionRow
          destructive
          icon={<Trash color="#ff3b30" size={19} />}
          label="Delete for everyone"
          onPress={props.onDeleteEveryone}
        />
      ) : null}
    </View>
  );
}

function OptionRow({
  destructive,
  icon,
  label,
  onPress,
}: {
  destructive: boolean;
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={styles.row}
    >
      {icon}
      <Text style={[styles.rowLabel, destructive && { color: "#ff3b30" }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  detail: {
    fontFamily: "SofiaProReg",
    fontSize: 12,
  },
  details: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 2,
    marginBottom: 8,
    paddingBottom: 8,
  },
  emoji: {
    fontSize: 26,
  },
  more: {
    alignItems: "center",
    borderRadius: 18,
    borderStyle: "dashed",
    borderWidth: 1,
    height: 34,
    justifyContent: "center",
    width: 34,
  },
  reaction: {
    alignItems: "center",
    borderRadius: 12,
    flex: 1,
    height: 48,
    justifyContent: "center",
  },
  reactions: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 4,
    marginBottom: 8,
    paddingBottom: 8,
  },
  row: {
    alignItems: "center",
    borderRadius: 12,
    flexDirection: "row",
    gap: 14,
    minHeight: 44,
    paddingHorizontal: 8,
  },
  rowLabel: {
    fontFamily: "SofiaProMed",
    fontSize: 15,
  },
});
