// One memoized message row of the DM transcript.
// The thread screen re-renders on every decrypt flush, typing pulse and
// watermark update. A plain renderItem would rebuild every bubble each time,
// because group metadata, receipts and callbacks are fresh objects per render.
// This row takes only primitives and referentially stable objects, so an
// unrelated store patch bails out here instead of re-rendering the bubble.
import type {
  BubbleEntranceRegistry,
  MessageReactionSummary,
} from "@asm/messages";
import { memo } from "react";
import { Text, View } from "react-native";
import type { SharedValue } from "react-native-reanimated";

import type { ConversationTheme } from "@/features/messages/lib/conversation-theme";
import type { DecryptEntry } from "@/features/messages/lib/decryptor";
import type { MessageGroupMeta } from "@/features/messages/lib/message-grouping";
import type { MessageReceipt } from "@/features/messages/lib/message-receipts";
import type { MessageData } from "@/features/messages/lib/types";
import { useAppTheme } from "@/theme";

import { MessageBubble } from "./message-bubble";
import { SelectableMessageRow } from "./selectable-message-row";

const EMPTY_REACTIONS: MessageReactionSummary[] = [];

function isPayload(entry: DecryptEntry | undefined) {
  return typeof entry === "object" && entry !== null;
}

export interface TranscriptMessageRowProps {
  conversationId: string;
  denSenderName: string | null;
  entrances: BubbleEntranceRegistry;
  entry: DecryptEntry | undefined;
  group: MessageGroupMeta;
  maxBubbleWidth: number;
  message: MessageData;
  mine: boolean;
  onOpenViewOnce: (
    mediaId: string,
    grantId: string,
    signal?: AbortSignal
  ) => Promise<string>;
  onCloseViewOnce: (mediaId: string, grantId: string) => Promise<void>;
  onPressImage: (messageId: string, index: number) => void;
  onReact: (messageId: string, emoji: string) => void;
  onRetry: (messageId: string) => void;
  onToggle: (id: string) => void;
  peerAvatarUrl?: string | null;
  quotedSenderId: string;
  quotedText: string | null;
  reactionPending: boolean;
  reactions?: MessageReactionSummary[];
  receiptAt: number | null;
  receiptStatus: MessageReceipt | null;
  searchJump: number;
  selected: boolean;
  selectionActive: boolean;
  showReceipt: boolean;
  swipeId: SharedValue<string>;
  swipeX: SharedValue<number>;
  theme: ConversationTheme;
}

function TranscriptMessageRowInner(props: TranscriptMessageRowProps) {
  const { theme } = useAppTheme();
  const { entry, group, message, mine } = props;
  const failed = entry === "error";
  return (
    <SelectableMessageRow
      id={message.id}
      mine={mine}
      selected={props.selected}
      selectionActive={props.selectionActive}
      onToggle={props.onToggle}
      swipeId={props.swipeId}
      swipeX={props.swipeX}
    >
      <View style={{ width: "100%" }}>
        {props.denSenderName ? (
          <Text
            style={{
              color: theme.dividerText,
              fontFamily: "SofiaProMed",
              fontSize: 12,
              marginBottom: 4,
              marginLeft: 44,
            }}
          >
            {props.denSenderName}
          </Text>
        ) : null}
        <MessageBubble
          entrances={props.entrances}
          messageId={message.id}
          searchJump={props.searchJump}
          deleted={Boolean(message.deletedAt)}
          edited={Boolean(message.editedAt)}
          failed={failed}
          group={group}
          maxBubbleWidth={props.maxBubbleWidth}
          mine={mine}
          onPressImage={(index) =>
            props.selectionActive
              ? props.onToggle(message.id)
              : props.onPressImage(message.id, index)
          }
          onOpenViewOnce={props.onOpenViewOnce}
          conversationId={props.conversationId}
          onCloseViewOnce={props.onCloseViewOnce}
          onRetry={() => props.onRetry(message.id)}
          onReact={(emoji) => props.onReact(message.id, emoji)}
          reactionPending={props.reactionPending}
          payload={isPayload(entry) ? entry : null}
          reactions={props.reactions ?? EMPTY_REACTIONS}
          peerAvatarUrl={props.peerAvatarUrl}
          receipt={
            props.receiptStatus
              ? { at: props.receiptAt, status: props.receiptStatus }
              : null
          }
          replyPreview={
            props.quotedText
              ? { senderId: props.quotedSenderId, text: props.quotedText }
              : null
          }
          showReceipt={props.showReceipt}
          theme={props.theme}
        />
      </View>
    </SelectableMessageRow>
  );
}

// Every prop is a primitive, a stable shared value, or a referentially stable
// store object, so the default shallow compare is exact: a new decrypt payload
// or edited message re-renders its own row, nothing else does.
export const TranscriptMessageRow = memo(TranscriptMessageRowInner);
TranscriptMessageRow.displayName = "TranscriptMessageRow";
