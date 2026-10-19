"use client";

import { Button } from "@asm/ui/shadui/button";
import { ArrowLeft, MoreHorizontal, PanelLeft } from "lucide-react";
import Link from "next/link";
import type { Ref } from "react";

import { navigateCommunityChat } from "@/lib/communities/chat-navigation";

import CommunityAvatar from "../card/community-avatar";
import { COMMUNITY_NAVIGATION_ID } from "./community-workspace-navigation";

interface Props {
  accentColor: string;
  avatarUrl: string | null;
  browseButtonRef: Ref<HTMLButtonElement>;
  channelId: string;
  channelName: string;
  channelsOpen: boolean;
  communityName: string;
  onBrowse: () => void;
  onTools: () => void;
  reconnecting: boolean;
  slug: string;
  thread: boolean;
}

export default function CommunityConversationHeader({
  browseButtonRef,
  ...props
}: Props) {
  return (
    <header
      className="border-border/50 flex h-16 shrink-0 items-center gap-1 border-b px-2 sm:gap-2 sm:px-4"
      data-community-chat-header
    >
      {props.thread ? (
        <Button
          asChild
          className="size-11 shrink-0 rounded-full"
          size="icon"
          variant="ghost"
        >
          <Link
            aria-label="Back to channel"
            href={`/a/${props.slug}/chat/${props.channelId}`}
            prefetch={false}
            onNavigate={(event) => {
              event.preventDefault();
              navigateCommunityChat(`/a/${props.slug}/chat/${props.channelId}`);
            }}
          >
            <ArrowLeft className="size-[18px]" />
          </Link>
        </Button>
      ) : null}
      <h1 className="sr-only">{props.communityName} chat</h1>
      <Button
        aria-expanded={props.channelsOpen}
        aria-controls={COMMUNITY_NAVIGATION_ID}
        aria-label="Toggle community sidebar"
        className="size-11 shrink-0 rounded-full xl:hidden"
        size="icon"
        variant="ghost"
        onClick={props.onBrowse}
        ref={browseButtonRef}
        type="button"
      >
        <PanelLeft />
      </Button>
      <div className="flex min-h-11 min-w-0 flex-1 items-center gap-2.5 px-1.5">
        <CommunityAvatar
          accentColor={props.accentColor}
          avatarUrl={props.avatarUrl}
          className="size-9 shrink-0"
          name={props.communityName}
          slug={props.slug}
        />
        <span className="min-w-0 flex-1">
          <span className="text-foreground block truncate text-[15px] font-bold">
            {props.communityName}
          </span>
          <span className="text-muted-foreground flex items-center gap-1 text-xs">
            <span className="truncate">
              {props.reconnecting
                ? "Reconnecting…"
                : `${props.thread ? "Thread" : "Chat"} · ${props.channelName}`}
            </span>
          </span>
        </span>
      </div>
      <Button
        aria-label="Conversation details and tools"
        className="size-11 shrink-0 rounded-full"
        onClick={props.onTools}
        size="icon"
        variant="ghost"
      >
        <MoreHorizontal className="size-5" />
      </Button>
    </header>
  );
}
