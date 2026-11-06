"use client";

import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@asm/ui/shadui/hover-card";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@asm/ui/shadui/popover";
import { MessageCircle, RotateCw, Users } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { useSession } from "@/app/(main)/session-provider";
import CommunityAvatar from "@/components/communities/card/community-avatar";
import CommunityCard from "@/components/communities/card/community-card";
import { useMediaQuery } from "@/hooks/use-media-query";
import { communityChatUiEnabled } from "@/lib/communities/chat-features";
import { useCommunityChatInboxQuery } from "@/lib/communities/client";
import type { CommunityChatInboxEntry } from "@/lib/communities/client";

const triggerClassName =
  "hover:bg-muted/70 focus-visible:ring-ring relative flex size-11 shrink-0 items-center justify-center rounded-xl outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-offset-2 motion-reduce:transition-none";

export function CommunityChatStrip() {
  const { user } = useSession();
  const hoverCapable = useMediaQuery("(hover: hover) and (pointer: fine)");
  const query = useCommunityChatInboxQuery(user?.id, communityChatUiEnabled);
  if (!communityChatUiEnabled || !user) {
    return null;
  }
  function renderCommunities() {
    if (query.isPending) {
      return (
        <output
          aria-label="Loading your communities"
          className="flex flex-col gap-2"
        >
          {[0, 1, 2].map((id) => (
            <div
              className="bg-muted size-11 animate-pulse rounded-xl motion-reduce:animate-none"
              key={id}
            />
          ))}
        </output>
      );
    }
    if (query.isError) {
      return (
        <button
          aria-label="Couldn't load community chats. Retry"
          className={triggerClassName}
          disabled={query.isFetching}
          onClick={async () => {
            await query.refetch();
          }}
          title="Couldn't load community chats. Retry"
          type="button"
        >
          <RotateCw
            aria-hidden="true"
            className="text-muted-foreground size-5"
          />
        </button>
      );
    }
    if (!query.data?.communities.length) {
      return (
        <Link
          aria-label="No joined communities. Browse communities"
          className={triggerClassName}
          href="/communities"
          prefetch={false}
          title="Find a community"
        >
          <Users aria-hidden="true" className="text-muted-foreground size-5" />
        </Link>
      );
    }
    return query.data.communities.map((entry) => (
      <CommunityChatShortcut
        entry={entry}
        hoverCapable={hoverCapable}
        key={entry.community.id}
      />
    ));
  }
  return (
    <nav
      aria-label="Community chats"
      className="border-border/60 flex w-16 shrink-0 flex-col border-r bg-[hsl(var(--background))]"
    >
      <div className="hide-native-scrollbar flex min-h-0 flex-1 flex-col items-center gap-2 overflow-x-hidden overflow-y-auto overscroll-contain pt-3 pb-[calc(6rem+env(safe-area-inset-bottom))] lg:pb-4">
        {renderCommunities()}
      </div>
    </nav>
  );
}

export function CommunityChatShortcut({
  entry,
  hoverCapable = false,
}: {
  entry: CommunityChatInboxEntry;
  hoverCapable?: boolean;
}) {
  const { community, hasUnread } = entry;
  const [open, setOpen] = useState(false);
  const label = `${community.name}${hasUnread ? ", unread messages" : ""}`;
  const chatHref = `/a/${community.slug}/chat`;
  const mark = (
    <>
      <CommunityAvatar
        accentColor={community.accentColor}
        avatarUrl={community.avatarUrl}
        className="size-10"
        name={community.name}
        slug={community.slug}
      />
      {hasUnread ? (
        <span
          aria-hidden="true"
          className="bg-primary ring-background absolute top-0.5 right-0.5 size-2.5 rounded-full ring-2"
        />
      ) : null}
    </>
  );
  const preview = (
    <>
      <CommunityCard community={community} showAura={false} />
      <div className="bg-popover border-border/60 sticky bottom-0 z-10 border-t p-3">
        <Link
          className="btn-3d-gray flex min-h-11 items-center justify-center gap-2 rounded-xl text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
          href={chatHref}
          onClick={() => setOpen(false)}
          prefetch={false}
        >
          <MessageCircle aria-hidden="true" className="size-4" />
          Open community chat
        </Link>
        {hasUnread ? (
          <p className="text-muted-foreground mt-2 text-center text-xs">
            Unread messages
          </p>
        ) : null}
      </div>
    </>
  );
  const previewClassName =
    "max-h-[calc(100dvh-1.5rem)] w-[min(20rem,calc(100vw-5rem))] overflow-y-auto p-0";

  // Fine pointers retain one-click chat navigation; touch gets a deliberate
  // preview with an explicit action, since hover has no touch equivalent.
  return hoverCapable ? (
    <HoverCard
      closeDelay={150}
      onOpenChange={setOpen}
      open={open}
      openDelay={250}
    >
      <HoverCardTrigger asChild>
        <Link
          aria-label={label}
          className={triggerClassName}
          href={chatHref}
          prefetch={false}
        >
          {mark}
        </Link>
      </HoverCardTrigger>
      <HoverCardContent
        align="start"
        className={previewClassName}
        collisionPadding={12}
        side="right"
        sideOffset={8}
      >
        {preview}
      </HoverCardContent>
    </HoverCard>
  ) : (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <button aria-label={label} className={triggerClassName} type="button">
          {mark}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        aria-label={`${community.name} community preview`}
        className={previewClassName}
        collisionPadding={12}
        side="right"
        sideOffset={8}
      >
        {preview}
      </PopoverContent>
    </Popover>
  );
}
