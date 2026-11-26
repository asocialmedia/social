"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import UserAvatar from "@/components/layouts/user/user-avatar";
import type { ConversationListResponse } from "@/lib/messages/client";
import { conversationListQuery } from "@/lib/messages/conversation-list-query";
import { conversationDisplayName } from "@/lib/messages/den-label";
import { hasDeparted } from "@/lib/messages/membership";
import { cn } from "@/lib/utils";

import { DenAvatarCollage } from "./den-avatar-collage";

function selectRecentChats(data: ConversationListResponse) {
  // The inbox API already returns visible chats in order of latest activity.
  return data.items.slice(0, 4);
}

export function RecentChatsRail({ userId }: { userId: string }) {
  const isInbox = usePathname() === "/messages";
  const selectedId = useSearchParams().get("c");
  const { data: chats } = useQuery({
    ...conversationListQuery(userId),
    refetchInterval: isInbox ? false : 60_000,
    select: selectRecentChats,
  });

  if (!chats?.length) {
    return null;
  }

  return (
    <ul
      aria-label="Recent chats"
      className="mt-0.5 mb-1 flex list-none flex-col gap-0.5 pl-4"
    >
      {chats.map(({ conversation, unreadCount }) => {
        const members = conversation.members.map((member) => ({
          avatarUrl: member.user.avatarUrl,
          displayName: member.user.displayName,
          hasDeparted: hasDeparted(member),
          id: member.userId,
          role: member.role,
          username: member.user.username,
        }));
        const name = conversationDisplayName(
          { members, name: conversation.name, type: conversation.type },
          userId
        );
        const peer = members.find((member) => member.id !== userId);
        const active = isInbox && selectedId === conversation.id;
        return (
          <li key={conversation.id}>
            <Link
              aria-current={active ? "location" : undefined}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-2xl border border-transparent px-3 py-1.5 text-sm transition-all duration-200 ease-out",
                active
                  ? "pill-nav-active"
                  : "pill-3d-hover text-muted-foreground hover:text-foreground"
              )}
              href={`/messages?c=${encodeURIComponent(conversation.id)}`}
              prefetch={false}
              title={name}
            >
              <span aria-hidden="true" className="shrink-0">
                {conversation.type === "DEN" ? (
                  <DenAvatarCollage
                    avatarMediaId={conversation.avatarMediaId}
                    members={members.filter((member) => !member.hasDeparted)}
                    myUserId={userId}
                    size={32}
                  />
                ) : (
                  <UserAvatar size={32} user={peer} />
                )}
              </span>
              <span
                className={cn(
                  "min-w-0 flex-1 truncate",
                  unreadCount > 0 && "text-foreground font-semibold"
                )}
              >
                {name}
              </span>
              {unreadCount > 0 ? (
                <span className="chip-3d flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums">
                  <span aria-hidden="true">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                  <span className="sr-only">
                    {unreadCount} unread{" "}
                    {unreadCount === 1 ? "message" : "messages"}
                  </span>
                </span>
              ) : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
