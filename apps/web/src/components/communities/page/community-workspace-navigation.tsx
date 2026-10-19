"use client";

import { Button } from "@asm/ui/shadui/button";
import {
  Sheet,
  SheetClose,
  SheetOverlay,
  SheetPortal,
  SheetDescription,
  SheetDialogContent,
  SheetHeader,
  SheetTitle,
} from "@asm/ui/shadui/sheet";
import {
  FileText,
  List,
  MessageCircle,
  PanelLeftClose,
  PanelLeftOpen,
  X,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode, RefObject } from "react";

import MobileBottomNav from "@/components/layouts/navigation/mobile/mobile-bottom-nav";
import { communityAccentStyle } from "@/lib/communities/accent";
import { communityChatUiEnabled } from "@/lib/communities/chat-features";
import { cn } from "@/lib/utils";

import CommunityAvatar from "../card/community-avatar";

export const COMMUNITY_NAVIGATION_ID = "community-workspace-navigation";

export default function CommunityWorkspaceNavigation({
  active,
  accentColor,
  avatarUrl,
  channelId,
  communityName,
  desktop,
  navigation,
  onOpenChange,
  open,
  slug,
  triggerRef,
}: {
  active: "posts" | "chat";
  accentColor: string;
  avatarUrl: string | null;
  channelId?: string;
  communityName: string;
  desktop: boolean;
  navigation: ReactNode;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  slug: string;
  triggerRef: RefObject<HTMLButtonElement | null>;
}) {
  const links = [
    { href: `/a/${slug}`, icon: FileText, key: "posts", label: "Posts" },
    ...(communityChatUiEnabled
      ? [
          {
            href: channelId
              ? `/a/${slug}/chat/${channelId}`
              : `/a/${slug}/chat`,
            icon: MessageCircle,
            key: "chat",
            label: "Chat",
          },
        ]
      : []),
  ];
  const sectionLinks = (collapsed: boolean) => (
    <nav
      aria-label={`${communityName} navigation`}
      className={cn(
        "flex gap-2 p-2",
        collapsed ? "flex-col" : "border-border/50 border-b"
      )}
    >
      {links.map(({ key, label, href, icon: Icon }) => (
        <Link
          key={key}
          href={href}
          title={collapsed ? label : undefined}
          aria-label={collapsed ? label : undefined}
          aria-current={active === key ? "page" : undefined}
          onClick={() => {
            if (!desktop) {
              onOpenChange(false);
            }
          }}
          className={cn(
            "focus-visible:outline-ring flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
            active === key
              ? "text-foreground bg-[color-mix(in_srgb,var(--community-accent-resolved)_14%,hsl(var(--background)))]"
              : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            !collapsed && "flex-1"
          )}
        >
          <Icon className="size-[18px] shrink-0" />
          {collapsed ? <span className="sr-only">{label}</span> : label}
        </Link>
      ))}
    </nav>
  );
  const identity = (
    <CommunityAvatar
      accentColor={accentColor}
      avatarUrl={avatarUrl}
      name={communityName}
      slug={slug}
      className="size-8 shrink-0"
      size={32}
    />
  );
  return (
    <>
      <aside
        aria-label="Community sidebar"
        id={desktop ? COMMUNITY_NAVIGATION_ID : undefined}
        className={cn(
          "community-accent-scope border-border/60 hidden min-h-0 shrink-0 flex-col border-r bg-[hsl(var(--background))] xl:flex",
          desktop && open ? "w-64" : "w-16"
        )}
        style={communityAccentStyle(accentColor)}
      >
        <div
          className={cn(
            "border-border/50 flex h-16 shrink-0 items-center border-b",
            open && desktop ? "gap-2 px-3" : "justify-center"
          )}
        >
          {desktop && open ? (
            <>
              <span className="shrink-0">{identity}</span>
              <span className="min-w-0 flex-1 truncate text-sm font-bold">
                {communityName}
              </span>
            </>
          ) : null}
          <Button
            aria-label={
              desktop && open
                ? "Collapse community sidebar"
                : "Expand community sidebar"
            }
            aria-controls={COMMUNITY_NAVIGATION_ID}
            aria-expanded={desktop && open}
            variant="ghost"
            size="icon"
            className="size-11 shrink-0 rounded-full"
            onClick={() => onOpenChange(!open)}
          >
            {desktop && open ? <PanelLeftClose /> : <PanelLeftOpen />}
          </Button>
        </div>
        {sectionLinks(!(desktop && open))}
        {desktop && open ? navigation : null}
        {!(desktop && open) && communityChatUiEnabled ? (
          <Button
            aria-label="Show community channels"
            title="Channels"
            variant="ghost"
            className="mx-2 min-h-11 rounded-xl px-0"
            onClick={() => onOpenChange(true)}
          >
            <List className="size-[18px]" />
            <span className="sr-only">Channels</span>
          </Button>
        ) : null}
      </aside>
      <Sheet open={!desktop && open} onOpenChange={onOpenChange}>
        <SheetPortal>
          <SheetOverlay />
          <SheetDialogContent
            id={desktop ? undefined : COMMUNITY_NAVIGATION_ID}
            className="community-accent-scope group data-[state=closed]:animate-out fixed inset-0 z-50 h-dvh outline-none data-[state=closed]:duration-240 motion-reduce:data-[state=closed]:duration-100"
            style={communityAccentStyle(accentColor)}
            onPointerDown={(event) => {
              if (event.target === event.currentTarget) {
                onOpenChange(false);
              }
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              triggerRef.current?.focus();
            }}
          >
            <SheetHeader className="sr-only">
              <SheetTitle>{communityName} navigation</SheetTitle>
              <SheetDescription>
                Switch between community posts, chat and channels.
              </SheetDescription>
            </SheetHeader>
            <div className="panel-3d group-data-[state=open]:animate-in group-data-[state=open]:slide-in-from-left group-data-[state=closed]:animate-out group-data-[state=closed]:slide-out-to-left pointer-events-auto relative flex h-full w-80 max-w-[calc(100vw-2.75rem)] flex-col gap-0 rounded-l-none! rounded-r-3xl! pt-[env(safe-area-inset-top)] pb-[calc(env(safe-area-inset-bottom)+6rem)] group-data-[state=closed]:duration-240 group-data-[state=open]:duration-250 motion-reduce:animate-none! sm:w-96 sm:max-w-sm">
              <SheetClose
                aria-label="Close"
                className="icon-btn-3d absolute top-[calc(env(safe-area-inset-top)+0.75rem)] right-3 flex size-11 items-center justify-center rounded-full"
              >
                <X className="size-4" />
              </SheetClose>
              <div className="border-border/50 flex min-h-16 shrink-0 items-center gap-3 border-b py-3 pr-16 pl-4">
                {identity}
                <span className="min-w-0 truncate text-sm font-bold">
                  {communityName}
                </span>
              </div>
              {sectionLinks(false)}
              {navigation}
            </div>
            <MobileBottomNav
              hidden={false}
              closing={!open}
              sidebar
              onNavigate={() => onOpenChange(false)}
            />
          </SheetDialogContent>
        </SheetPortal>
      </Sheet>
    </>
  );
}
