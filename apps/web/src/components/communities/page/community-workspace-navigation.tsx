"use client";

import {
  communityFeedSearchParams,
  readCommunityFeedSelection,
} from "@asm/db/communities";
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
  Clock,
  FileText,
  List,
  MessageCircle,
  PanelLeftClose,
  PanelLeftOpen,
  TrendingUp,
  X,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode, RefObject } from "react";
import { useContext } from "react";

import { LinkStatusHint } from "@/components/layouts/feedback/link-status-hint";
import MobileBottomNav from "@/components/layouts/navigation/mobile/mobile-bottom-nav";
import { useCommunitySectionLinks } from "@/hooks/use-community-section-links";
import { communityAccentStyle } from "@/lib/communities/accent";
import { communityChatUiEnabled } from "@/lib/communities/chat-features";
import { navigateCommunityChat } from "@/lib/communities/chat-navigation";
import { cn } from "@/lib/utils";

import CommunityAvatar from "../card/community-avatar";
import { CommunityWorkspacePortalContext } from "./community-workspace-context";

export function communityNavigationRowClassName(active = false) {
  return cn(
    "group focus-visible:outline-ring mb-0.5 flex min-h-10 w-full min-w-0 items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm leading-5 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] motion-reduce:transition-none",
    active
      ? "chip-3d-raised text-foreground font-semibold [&:active]:brightness-95 [&:hover]:brightness-110"
      : "pill-3d-hover text-muted-foreground border border-transparent"
  );
}

export function communityNavigationChatIconClassName(active: boolean) {
  return cn(
    "size-4 shrink-0",
    active && "fill-current text-[var(--community-accent-resolved)]"
  );
}

const sidebarIconButton =
  "sidebar-icon-hover text-muted-foreground hover:text-foreground flex size-10 shrink-0 items-center justify-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring";

export const COMMUNITY_NAVIGATION_ID = "community-workspace-navigation";

export default function CommunityWorkspaceNavigation({
  active,
  accentColor,
  avatarUrl,
  channelId,
  communityName,
  desktop,
  globalChatHref,
  navigation,
  onOpenChange,
  open,
  postsSearchParams = "",
  slug,
  triggerRef,
}: {
  active: "posts" | "chat";
  accentColor: string;
  avatarUrl: string | null;
  channelId?: string;
  communityName: string;
  desktop: boolean;
  globalChatHref?: string;
  navigation: ReactNode;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  postsSearchParams?: string;
  slug: string;
  triggerRef: RefObject<HTMLButtonElement | null>;
}) {
  const workspaceElement = useContext(CommunityWorkspacePortalContext);
  const { postsHref, chatHref } = useCommunitySectionLinks(slug, channelId);
  const links = [
    { href: postsHref, icon: FileText, key: "posts", label: "Posts" },
    ...(communityChatUiEnabled
      ? [
          {
            href:
              active === "posts"
                ? (globalChatHref ?? `/a/${slug}/chat`)
                : chatHref,
            icon: MessageCircle,
            key: "chat",
            label: active === "posts" ? "Global chat" : "Chat",
          },
        ]
      : []),
  ];
  const sectionLinks = (collapsed: boolean) => (
    <nav
      aria-label={`${communityName} navigation`}
      className={cn(
        "flex shrink-0",
        collapsed
          ? "flex-col items-center gap-1 px-2 py-1"
          : "mx-3 mb-1 gap-1.5"
      )}
    >
      {links.map(({ key, label, href, icon: Icon }) => (
        <Link
          key={key}
          href={href}
          prefetch={
            active !== key && (key === "posts" || Boolean(globalChatHref))
          }
          scroll={false}
          onNavigate={(event) => {
            if (active === "chat" && key === "chat" && channelId) {
              if (!desktop) {
                onOpenChange(false);
              }
              event.preventDefault();
              navigateCommunityChat(href);
            }
          }}
          title={collapsed ? label : undefined}
          aria-label={collapsed ? label : undefined}
          aria-current={active === key ? "page" : undefined}
          data-state={active === key ? "active" : "inactive"}
          className={cn(
            "focus-visible:outline-ring relative flex min-h-10 min-w-0 items-center justify-center gap-1.5 rounded-lg text-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] motion-reduce:transition-none",
            collapsed ? "size-10 shrink-0" : "flex-1 px-2",
            active === key
              ? "chip-3d-raised font-semibold [&:active]:brightness-95 [&:hover]:brightness-110"
              : "text-muted-foreground [&:hover]:bg-muted/50 [&:hover]:text-foreground [&:active]:bg-muted border border-transparent font-medium"
          )}
        >
          <Icon
            aria-hidden="true"
            className={cn(
              "size-4 shrink-0",
              active === key &&
                "fill-current text-[var(--community-accent-resolved)]",
              active === key &&
                key === "posts" &&
                "[&>path:not(:first-child)]:stroke-background"
            )}
          />
          <span className={collapsed ? "sr-only" : "truncate"}>{label}</span>
          {active === key ? null : (
            <LinkStatusHint className="absolute right-1 bottom-1 size-2.5" />
          )}
        </Link>
      ))}
    </nav>
  );
  const selection = readCommunityFeedSelection(
    new URLSearchParams(postsSearchParams)
  );
  const navigationContent = (
    <>
      {active === "posts" ? (
        <nav aria-label="Post sorting" className="mx-2 mb-2 shrink-0">
          <h2 className="text-muted-foreground px-3 pt-2 pb-1 text-xs font-semibold">
            Sort posts
          </h2>
          {(
            [
              { icon: Clock, label: "New", sort: "new" },
              { icon: TrendingUp, label: "Top", sort: "top" },
            ] as const
          ).map(({ icon: Icon, label, sort }) => {
            const current = selection.sort === sort;
            const params = communityFeedSearchParams(
              { ...selection, sort },
              postsSearchParams
            );
            const href = `/a/${slug}${params.size ? `?${params}` : ""}`;
            return (
              <Link
                aria-current={current ? "page" : undefined}
                className={communityNavigationRowClassName(current)}
                href={href}
                key={sort}
                onNavigate={(event) => {
                  event.preventDefault();
                  if (
                    `${window.location.pathname}${window.location.search}` !==
                    href
                  ) {
                    window.history.pushState(null, "", href);
                  }
                  if (!desktop) {
                    onOpenChange(false);
                  }
                }}
                prefetch={false}
                scroll={false}
              >
                <Icon
                  aria-hidden="true"
                  className={cn(
                    "size-4 shrink-0",
                    current && "text-[var(--community-accent-resolved)]"
                  )}
                />
                {label}
              </Link>
            );
          })}
        </nav>
      ) : null}
      {navigation}
    </>
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
  const communityLabel = (
    <p
      className="min-w-0 flex-1 truncate text-sm font-semibold"
      title={communityName}
    >
      {communityName}
    </p>
  );
  return (
    <>
      <aside
        aria-label="Community sidebar"
        id={desktop ? COMMUNITY_NAVIGATION_ID : undefined}
        className={cn(
          "community-accent-scope bg-background border-border/60 hidden min-h-0 shrink-0 flex-col border-r xl:flex",
          desktop && open ? "w-64" : "w-16"
        )}
        style={communityAccentStyle(accentColor)}
      >
        <div
          className={cn(
            "flex h-15 shrink-0 items-center",
            open && desktop ? "gap-2 px-3" : "justify-center"
          )}
        >
          {desktop && open ? (
            <>
              {identity}
              {communityLabel}
            </>
          ) : null}
          <button
            aria-label={
              desktop && open
                ? "Collapse community sidebar"
                : "Expand community sidebar"
            }
            aria-controls={COMMUNITY_NAVIGATION_ID}
            aria-expanded={desktop && open}
            className={sidebarIconButton}
            onClick={() => onOpenChange(!open)}
            type="button"
          >
            {desktop && open ? (
              <PanelLeftClose className="size-4" />
            ) : (
              <PanelLeftOpen className="size-4" />
            )}
          </button>
        </div>
        {sectionLinks(!(desktop && open))}
        {desktop && open ? navigationContent : null}
        {!(desktop && open) && communityChatUiEnabled ? (
          <button
            aria-label="Show community channels"
            title="Channels"
            className={cn(sidebarIconButton, "mt-1 self-center")}
            onClick={() => onOpenChange(true)}
            type="button"
          >
            <List className="size-[18px]" />
            <span className="sr-only">Channels</span>
          </button>
        ) : null}
      </aside>
      <Sheet open={!desktop && open} onOpenChange={onOpenChange}>
        {workspaceElement ? (
          <SheetPortal container={workspaceElement}>
            <SheetOverlay className="absolute bg-black/35" />
            <SheetDialogContent
              id={desktop ? undefined : COMMUNITY_NAVIGATION_ID}
              className="community-accent-scope group data-[state=closed]:animate-out absolute inset-0 z-50 h-full overflow-hidden outline-none data-[state=closed]:duration-240 motion-reduce:data-[state=closed]:duration-100"
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
              <div className="panel-3d group-data-[state=open]:animate-in group-data-[state=open]:slide-in-from-left group-data-[state=closed]:animate-out group-data-[state=closed]:slide-out-to-left pointer-events-auto relative flex h-full w-80 max-w-[calc(100%_-_2.75rem)] flex-col gap-0 rounded-l-none! rounded-r-2xl! pt-[env(safe-area-inset-top)] pb-[calc(env(safe-area-inset-bottom)+6rem)] group-data-[state=closed]:duration-240 group-data-[state=open]:duration-250 motion-reduce:animate-none!">
                <SheetClose
                  aria-label="Close"
                  className={cn(
                    sidebarIconButton,
                    "absolute top-[calc(env(safe-area-inset-top)+0.625rem)] right-3"
                  )}
                >
                  <X className="size-4" />
                </SheetClose>
                <div className="flex min-h-15 shrink-0 items-center gap-2 py-3 pr-16 pl-3">
                  {identity}
                  {communityLabel}
                </div>
                {sectionLinks(false)}
                {navigationContent}
              </div>
              <MobileBottomNav
                hidden={false}
                closing={!open}
                sidebar
                onNavigate={() => onOpenChange(false)}
              />
            </SheetDialogContent>
          </SheetPortal>
        ) : null}
      </Sheet>
    </>
  );
}
