"use client";

import { Button } from "@asm/ui/shadui/button";
import { MessageCircle, PanelLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode, Ref } from "react";

import { useCommunitySectionLinks } from "@/hooks/use-community-section-links";
import { communityAccentStyle } from "@/lib/communities/accent";
import { communityChatUiEnabled } from "@/lib/communities/chat-features";

import CommunitySectionLinkContent from "./community-section-link-content";
import { COMMUNITY_NAVIGATION_ID } from "./community-workspace-navigation";

interface CommunitySectionNavProps {
  identity?: ReactNode;
  showSections?: boolean;
  accentColor: string;
  globalChatHref?: string;
  slug: string;
  navigationOpen?: boolean;
  onOpenNavigation?: () => void;
  navigationTriggerRef?: Ref<HTMLButtonElement>;
}

export default function CommunitySectionNav({
  showSections = true,
  identity,
  accentColor,
  globalChatHref,
  slug,
  navigationOpen,
  onOpenNavigation,
  navigationTriggerRef,
}: CommunitySectionNavProps) {
  const { chatHref } = useCommunitySectionLinks(slug);
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
          className="pointer-events-auto my-auto size-11 shrink-0 rounded-full xl:hidden"
          variant="ghost"
          size="icon"
          onClick={onOpenNavigation}
          ref={navigationTriggerRef}
        >
          <PanelLeft />
        </Button>
      ) : null}
      {identity}
      {showSections && communityChatUiEnabled ? (
        <Button
          asChild
          className="pointer-events-auto relative my-auto size-11 shrink-0 rounded-full"
          size="icon"
          variant="ghost"
        >
          <Link
            aria-label="Open community Dens"
            href={globalChatHref ?? chatHref}
            prefetch={globalChatHref ? true : undefined}
            scroll={false}
            title="Dens"
          >
            <CommunitySectionLinkContent>
              <MessageCircle aria-hidden="true" className="size-5" />
            </CommunitySectionLinkContent>
          </Link>
        </Button>
      ) : null}
    </nav>
  );
}
