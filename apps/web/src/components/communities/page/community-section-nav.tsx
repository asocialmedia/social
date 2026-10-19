import { Button } from "@asm/ui/shadui/button";
import { PanelLeft } from "lucide-react";
import Link from "next/link";
import type { Ref } from "react";

import { communityAccentStyle } from "@/lib/communities/accent";
import { communityChatUiEnabled } from "@/lib/communities/chat-features";
import { cn } from "@/lib/utils";

import { COMMUNITY_NAVIGATION_ID } from "./community-workspace-navigation";

interface CommunitySectionNavProps {
  active: "chat" | "posts";
  accentColor: string;
  channelId?: string;
  slug: string;
  navigationOpen?: boolean;
  onOpenNavigation?: () => void;
  navigationTriggerRef?: Ref<HTMLButtonElement>;
}

export default function CommunitySectionNav({
  active,
  accentColor,
  channelId,
  slug,
  navigationOpen,
  onOpenNavigation,
  navigationTriggerRef,
}: CommunitySectionNavProps) {
  const links = [
    { href: `/a/${slug}`, key: "posts" as const, label: "Posts" },
    {
      href: channelId ? `/a/${slug}/chat/${channelId}` : `/a/${slug}/chat`,
      key: "chat" as const,
      label: "Chat",
    },
  ];

  return (
    <nav
      aria-label={`${slug} community sections`}
      className="community-accent-scope border-border/60 flex h-12 items-stretch gap-1 border-b px-3"
      style={communityAccentStyle(accentColor)}
    >
      {onOpenNavigation ? (
        <Button
          aria-label="Open community sidebar"
          aria-controls={COMMUNITY_NAVIGATION_ID}
          aria-expanded={navigationOpen}
          aria-haspopup="dialog"
          className="my-auto size-11 shrink-0 rounded-full lg:hidden"
          variant="ghost"
          size="icon"
          onClick={onOpenNavigation}
          ref={navigationTriggerRef}
        >
          <PanelLeft />
        </Button>
      ) : null}
      {links
        .filter((link) => link.key !== "chat" || communityChatUiEnabled)
        .map((link) => (
          <Link
            aria-current={active === link.key ? "page" : undefined}
            className={cn(
              "relative flex min-w-20 items-center justify-center rounded-t-lg px-3 text-sm font-semibold transition-colors",
              active === link.key
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            )}
            href={link.href}
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
    </nav>
  );
}
