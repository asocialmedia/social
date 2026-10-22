import { Button } from "@asm/ui/shadui/button";
import { PanelLeft } from "lucide-react";
import type { ReactNode, Ref } from "react";

import { communityAccentStyle } from "@/lib/communities/accent";

import CommunitySectionLinks from "./community-section-links";
import { COMMUNITY_NAVIGATION_ID } from "./community-workspace-navigation";

interface CommunitySectionNavProps {
  identity?: ReactNode;
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
  identity,
  accentColor,
  channelId,
  slug,
  navigationOpen,
  onOpenNavigation,
  navigationTriggerRef,
}: CommunitySectionNavProps) {
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
      <CommunitySectionLinks
        active={active}
        channelId={channelId}
        slug={slug}
      />
    </nav>
  );
}
