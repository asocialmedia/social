"use client";

import { BellOff } from "lucide-react";
import { memo } from "react";

import UserAvatar from "@/components/layouts/user/user-avatar";
import UserBadge from "@/components/layouts/user/user-badge";
import type { ConversationListItem } from "@/lib/messages/client";
import { conversationPreviewText } from "@/lib/messages/message-preview";
import { formatArrivalCount } from "@/lib/messages/scroll-state";
import { useDecryptEntry } from "@/lib/messages/use-decrypt-entry";
import { cn, formatRelativeDate } from "@/lib/utils";

interface ConversationRowProps {
  active: boolean;
  item: ConversationListItem;
  myUserId: string;
  onSelect: (conversationId: string) => void;
  presence: "idle" | "online" | null;
}

// One conversation, as the list shows it: who it is with, what was said last, when,
// and whether it is waiting on the reader.
//
// A row rather than an icon, because the list's job with nothing open is to be read
// rather than scanned: the badge alone can say a conversation is unread, but only
// the preview says whether it is worth opening. The rail keeps the icon form for
// when a conversation IS open and the list is the way around rather than the way in.
//
// The preview is decrypted per row by this component, not passed in. That is the
// transcript's own pattern: `useDecryptEntry` subscribes to one message, so a batch
// of completions re-renders only the rows whose previews landed instead of the whole
// list once per message.
function ConversationRowInner({
  active,
  item,
  myUserId,
  onSelect,
  presence,
}: ConversationRowProps) {
  const myMember = item.conversation.members.find(
    (member) => member.userId === myUserId
  );
  const peer = item.conversation.members.find(
    (member) => member.userId !== myUserId
  )?.user;
  const { lastMessage } = item;
  // Mute is this member's own preference, read off their membership row.
  const muted = Boolean(myMember?.mutedAt);
  const unread = item.unreadCount > 0;
  const payload = useDecryptEntry(lastMessage?.id);
  const settled =
    payload && payload !== "error" && payload !== "pending"
      ? payload
      : undefined;
  const preview = conversationPreviewText({
    deleted: Boolean(lastMessage?.deletedAt),
    mine: lastMessage?.senderId === myUserId,
    payload: settled,
  });
  const time = lastMessage ? formatRelativeDate(lastMessage.createdAt) : "";

  return (
    <button
      // No aria-label: the row's own text IS its name, so a screen reader reads the
      // person and what they said. The badge is the one part that does not read as
      // what it is -- a bare number -- so it carries the noun.
      className={cn(
        "group flex w-full cursor-pointer items-center gap-3 rounded-2xl px-2.5 py-2.5 text-left",
        // `surface-3d` on the selected row, and no background utility beside it: the
        // recipe lives in `@layer components`, so a `bg-*` here would win the cascade
        // and the lift would silently do nothing.
        active ? "surface-3d" : "hover:bg-muted/50 transition-colors"
      )}
      onClick={() => onSelect(item.conversation.id)}
      type="button"
    >
      <span className="relative shrink-0">
        <UserAvatar avatarUrl={peer?.avatarUrl ?? null} size={44} />
        {presence ? (
          <span
            className={cn(
              "border-background absolute right-0 bottom-0 size-3 rounded-full border-2",
              presence === "online" ? "bg-green-500" : "bg-amber-500"
            )}
          />
        ) : null}
        {muted ? (
          <span className="bg-background absolute -bottom-0.5 -left-0.5 flex size-4 items-center justify-center rounded-full">
            <BellOff className="text-muted-foreground size-2.5" />
          </span>
        ) : null}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span
            className={cn(
              "min-w-0 truncate text-sm",
              unread ? "font-semibold" : "font-medium"
            )}
          >
            {peer?.displayName ?? peer?.username ?? "Conversation"}
          </span>
          <UserBadge
            badge={peer?.badge}
            badges={peer?.badges}
            communityRoles={peer?.communityMemberships}
          />
        </span>
        <span
          className={cn(
            "mt-0.5 block truncate text-xs",
            unread ? "text-foreground/90 font-medium" : "text-muted-foreground"
          )}
        >
          {preview || (muted ? "Muted" : "")}
        </span>
      </span>

      <span className="flex shrink-0 flex-col items-end gap-1.5 self-stretch pt-0.5">
        <span
          className={cn(
            "text-[10px] tabular-nums",
            unread ? "text-primary font-semibold" : "text-muted-foreground"
          )}
        >
          {time}
        </span>
        {unread ? (
          <span className="bg-primary text-primary-foreground flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums">
            {formatArrivalCount(item.unreadCount)}
            <span className="sr-only"> unread</span>
          </span>
        ) : null}
      </span>
    </button>
  );
}

// Memoized because the list re-renders on every poll and every presence tick, and a
// row whose own props did not change has nothing to redraw. The preview it shows
// comes from its own decrypt subscription, which re-renders it directly.
export const ConversationRow = memo(ConversationRowInner);
