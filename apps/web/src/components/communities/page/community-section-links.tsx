"use client";

import { Button } from "@asm/ui/shadui/button";
import { MessageCircle } from "lucide-react";
import Link from "next/link";

import { LinkStatusHint } from "@/components/layouts/feedback/link-status-hint";
import { useCommunitySectionLinks } from "@/hooks/use-community-section-links";
import { communityChatUiEnabled } from "@/lib/communities/chat-features";
import { navigateCommunityChat } from "@/lib/communities/chat-navigation";
import { cn } from "@/lib/utils";

export default function CommunitySectionLinks({
  active,
  channelId,
  globalChatHref,
  slug,
}: {
  active: "posts" | "chat";
  channelId?: string;
  globalChatHref?: string;
  slug: string;
}) {
  const { postsHref, chatHref } = useCommunitySectionLinks(slug, channelId);
  if (active === "posts") {
    return communityChatUiEnabled ? (
      <Button
        asChild
        className="pointer-events-auto relative my-auto size-11 shrink-0 rounded-full"
        size="icon"
        variant="ghost"
      >
        <Link
          aria-label="Open community chat"
          href={globalChatHref ?? chatHref}
          prefetch={globalChatHref ? true : undefined}
          scroll={false}
          title="Chat"
        >
          <MessageCircle aria-hidden="true" className="size-5" />
          <LinkStatusHint className="absolute right-0 bottom-0" />
        </Link>
      </Button>
    ) : null;
  }
  const links = [
    { href: postsHref, key: "posts" as const, label: "Posts" },
    {
      href: chatHref,
      key: "chat" as const,
      label: "Chat",
    },
  ];

  return (
    <div className="flex shrink-0 self-stretch">
      {links
        .filter((link) => link.key !== "chat" || communityChatUiEnabled)
        .map((link) => (
          <Link
            aria-current={active === link.key ? "page" : undefined}
            className={cn(
              "pointer-events-auto relative flex min-w-14 shrink-0 items-center justify-center rounded-t-lg px-3 text-sm font-semibold transition-colors",
              active === link.key
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            )}
            href={link.href}
            prefetch={link.key === "posts"}
            scroll={false}
            onNavigate={(event) => {
              if (active === "chat" && link.key === "chat" && channelId) {
                event.preventDefault();
                navigateCommunityChat(link.href);
              }
            }}
            key={link.key}
          >
            {link.label}
            <LinkStatusHint className="ml-1 shrink-0" />
            {active === link.key ? (
              <span
                aria-hidden="true"
                className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-[var(--community-accent-resolved)]"
              />
            ) : null}
          </Link>
        ))}
    </div>
  );
}
