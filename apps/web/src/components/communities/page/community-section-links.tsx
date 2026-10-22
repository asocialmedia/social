"use client";

import Link from "next/link";

import { useCommunitySectionLinks } from "@/hooks/use-community-section-links";
import { communityChatUiEnabled } from "@/lib/communities/chat-features";
import { navigateCommunityChat } from "@/lib/communities/chat-navigation";
import { cn } from "@/lib/utils";

export default function CommunitySectionLinks({
  active,
  channelId,
  slug,
}: {
  active: "posts" | "chat";
  channelId?: string;
  slug: string;
}) {
  const { postsHref, chatHref } = useCommunitySectionLinks(slug, channelId);
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
            prefetch={
              active === "chat" && link.key === "chat" ? false : undefined
            }
            onNavigate={(event) => {
              if (active === "chat" && link.key === "chat" && channelId) {
                event.preventDefault();
                navigateCommunityChat(link.href);
              }
            }}
            key={link.key}
          >
            {link.label}
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
