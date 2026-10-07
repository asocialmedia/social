"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@asm/ui/shadui/tooltip";
import { BellOff } from "lucide-react";
import { memo } from "react";

import UserAvatar from "@/components/layouts/user/user-avatar";
import UserBadge from "@/components/layouts/user/user-badge";
import { DenAvatarCollage } from "@/components/messages/den-avatar-collage";
import type { ConversationListItem } from "@/lib/messages/client";
import {
  conversationDisplayName,
  denMemberCountLabel,
  denPreviewLine,
} from "@/lib/messages/den-label";
import { hasDeparted } from "@/lib/messages/membership";
import { conversationPreviewText } from "@/lib/messages/message-preview";
import { formatArrivalCount } from "@/lib/messages/scroll-state";
import { useDecryptEntry } from "@/lib/messages/use-decrypt-entry";
import { cn, formatRelativeDate } from "@/lib/utils";

interface ConversationRowProps {
  active: boolean;
  collapsed?: boolean;
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
// A den and a DM differ in exactly three places, and all three are derived from the
// conversation's own `type` rather than from a flag passed down:
//
//   - the face: one avatar for a DM, a stacked group of them for a den;
//   - the heading: the peer's name for a DM, the den's name (or its members, if it
//     has none) for a den, and no per-person badges, because a room has no badge;
//   - the preview: what was said, versus who said it. A den's second line is
//     prefixed with the sender, because the heading says WHERE and the preview is
//     the only place the byline can live.
//
// The unread badge and the muted-shows-zero rule are untouched. Both are computed
// per row by the server, and this component only decides which pixels they land on.
//
// The preview is decrypted per row by this component, not passed in. That is the
// transcript's own pattern: `useDecryptEntry` subscribes to one message, so a batch
// of completions re-renders only the rows whose previews landed instead of the whole
// list once per message.
function ConversationRowInner({
  active,
  collapsed = false,
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
  const isDen = item.conversation.type === "DEN";
  const { lastMessage } = item;
  // Mute is this member's own preference, read off their membership row.
  const muted = Boolean(myMember?.mutedAt);
  // A den this reader has left or been removed from. It stays in the rail and
  // still opens, so the row has to say what it now is: the preview is replaced by
  // the state, and a chip marks it, because a row that looked ordinary and then
  // refused to send would read as a broken thread rather than as a den that ended
  // for this person.
  const left = isDen && hasDeparted(myMember);
  const unread = item.unreadCount > 0;
  const payload = useDecryptEntry(lastMessage?.id);
  const settled =
    payload && payload !== "error" && payload !== "pending"
      ? payload
      : undefined;
  // The sender-prefixed den line and the bare DM line come out of one pure
  // helper, so a row cannot render "Ada: " in a DM by accident or drop the
  // prefix in a den.
  const preview = denPreviewLine({
    conversation: {
      members: item.conversation.members.map((member) => ({
        avatarUrl: member.user.avatarUrl,
        displayName: member.user.displayName,
        id: member.userId,
        username: member.user.username,
      })),
      name: item.conversation.name,
      type: item.conversation.type,
    },
    lastSenderId: lastMessage?.senderId ?? null,
    myUserId,
    preview: conversationPreviewText({
      deleted: Boolean(lastMessage?.deletedAt),
      mine: lastMessage?.senderId === myUserId,
      payload: settled,
    }),
  });
  const time = lastMessage ? formatRelativeDate(lastMessage.createdAt) : "";
  const heading = conversationDisplayName(
    {
      members: item.conversation.members.map((member) => ({
        avatarUrl: member.user.avatarUrl,
        displayName: member.user.displayName,
        id: member.userId,
        username: member.user.username,
      })),
      name: item.conversation.name,
      type: item.conversation.type,
    },
    myUserId
  );
  const rowName =
    item.conversation.type === "DEN"
      ? `${heading}, ${denMemberCountLabel(item.conversation.members.length)}`
      : heading;
  const label =
    item.unreadCount > 0
      ? `${rowName}, ${item.unreadCount} unread message${item.unreadCount === 1 ? "" : "s"}`
      : `${rowName}${muted ? ", muted" : ""}`;

  let activeStyle = "hover:bg-muted/50";
  if (active && collapsed) {
    activeStyle =
      "border-border/60 bg-primary/15 border shadow-[inset_0_1px_1px_rgba(255,255,255,0.4)]";
  } else if (active) {
    activeStyle = "surface-3d";
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          aria-label={collapsed ? label : undefined}
          className={cn(
            "group relative flex w-full cursor-pointer items-center overflow-hidden text-left transition-all duration-300 ease-[cubic-bezier(0.25,1,0.5,1)]",
            collapsed
              ? "h-12 justify-center gap-0 rounded-xl px-0"
              : "h-16 justify-start gap-3 rounded-2xl px-2.5 py-2.5",
            activeStyle
          )}
          onClick={() => onSelect(item.conversation.id)}
          type="button"
        >
          <span className="relative shrink-0">
            {isDen ? (
              <DenAvatarCollage
                avatarMediaId={item.conversation.avatarMediaId ?? null}
                members={item.conversation.members.map((member) => ({
                  avatarUrl: member.user.avatarUrl,
                  displayName: member.user.displayName,
                  id: member.userId,
                  role: member.role ?? null,
                  username: member.user.username,
                }))}
                myUserId={myUserId}
                size={40}
              />
            ) : (
              <UserAvatar avatarUrl={peer?.avatarUrl ?? null} size={40} />
            )}
            {/* Presence is a property of a person, so a den has none to show. The
                bell is not: it is this member's own preference and reads the same
                either way. */}
            {presence && !isDen ? (
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
            {/* Rail unread badge top-right of avatar when collapsed */}
            <span
              className={cn(
                "bg-primary text-primary-foreground absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums shadow-xs transition-all duration-300 ease-[cubic-bezier(0.25,1,0.5,1)]",
                unread && collapsed
                  ? "scale-100 opacity-100"
                  : "pointer-events-none scale-0 opacity-0"
              )}
            >
              {formatArrivalCount(item.unreadCount)}
            </span>
          </span>

          <span
            className={cn(
              "min-w-0 flex-1 text-left transition-all duration-300 ease-[cubic-bezier(0.25,1,0.5,1)]",
              collapsed
                ? "pointer-events-none max-w-0 overflow-hidden opacity-0"
                : "opacity-100"
            )}
          >
            <span className="flex min-w-0 items-center gap-1.5 text-left">
              <span
                className={cn(
                  "min-w-0 truncate text-left text-sm",
                  unread ? "font-semibold" : "font-medium",
                  left && "text-muted-foreground"
                )}
              >
                {heading}
              </span>
              {/* A room has no badge of its own, and a den member's badge says nothing
                  about the room, so the per-person badge row is DM-only. The one chip a
                  den row does carry is "Left": it is not about a person. */}
              {left ? (
                <span className="chip-3d text-muted-foreground shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium">
                  Left
                </span>
              ) : null}
              {isDen ? null : (
                <UserBadge
                  badge={peer?.badge}
                  badges={peer?.badges}
                  communityRoles={peer?.communityMemberships}
                />
              )}
            </span>
            <span
              className={cn(
                "mt-0.5 block truncate text-left text-xs",
                unread
                  ? "text-foreground/90 font-medium"
                  : "text-muted-foreground"
              )}
            >
              {/* A departed den ignores the preview: "what was said last" is not what
                  this row's reader needs to know, and the newest message may even be
                  one they cannot decrypt. The state they are in is the useful line. */}
              {left ? "You left this den" : preview || (muted ? "Muted" : "")}
            </span>
          </span>

          <span
            className={cn(
              "flex shrink-0 flex-col items-end gap-1.5 self-stretch pt-0.5 transition-all duration-300 ease-[cubic-bezier(0.25,1,0.5,1)]",
              collapsed
                ? "pointer-events-none max-w-0 overflow-hidden opacity-0"
                : "opacity-100"
            )}
          >
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
      </TooltipTrigger>
      {collapsed ? (
        <TooltipContent className="tooltip-3d" side="right" sideOffset={12}>
          {rowName}
        </TooltipContent>
      ) : null}
    </Tooltip>
  );
}

// Memoized because the list re-renders on every poll and every presence tick, and a
// row whose own props did not change has nothing to redraw. The preview it shows
// comes from its own decrypt subscription, which re-renders it directly.
export const ConversationRow = memo(ConversationRowInner);
