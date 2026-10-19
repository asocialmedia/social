"use client";

import { Button } from "@asm/ui/shadui/button";
import { ArrowLeft, ChevronDown, MoreHorizontal } from "lucide-react";
import Link from "next/link";
import type { Ref } from "react";

import CommunityAvatar from "../card/community-avatar";

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
      <Button
        asChild
        className="size-11 shrink-0 rounded-full"
        size="icon"
        variant="ghost"
      >
        <Link
          aria-label={
            props.thread ? "Back to channel" : "Back to community posts"
          }
          href={
            props.thread
              ? `/a/${props.slug}/chat/${props.channelId}`
              : `/a/${props.slug}`
          }
        >
          <ArrowLeft className="size-[18px]" />
        </Link>
      </Button>
      <h1 className="sr-only">{props.communityName} chat</h1>
      <button
        aria-expanded={props.channelsOpen}
        aria-haspopup="dialog"
        aria-label={`Choose conversation, currently ${props.channelName}`}
        className="hover:bg-muted/50 flex min-h-11 min-w-0 flex-1 items-center gap-2.5 rounded-2xl px-1.5 text-left transition-colors"
        onClick={props.onBrowse}
        ref={browseButtonRef}
        type="button"
      >
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
            <ChevronDown className="size-3 shrink-0" />
          </span>
        </span>
      </button>
      <Link
        className="chip-3d text-muted-foreground hidden min-h-9 items-center rounded-full! px-4 text-xs font-semibold sm:inline-flex"
        href={`/a/${props.slug}`}
      >
        Posts
      </Link>
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
