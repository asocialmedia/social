"use client";

import type { MessageConversationData, MessageData } from "@asm/db";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@asm/ui/shadui/sheet";
import { Switch } from "@asm/ui/shadui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@asm/ui/shadui/tabs";
import { useQueryClient } from "@tanstack/react-query";
import {
  Ban,
  BellOff,
  Check,
  ChevronRight,
  Flag,
  Palette,
  UserRound,
  Volume2,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type React from "react";
import { useCallback, useEffect, useId, useState } from "react";

import UserAvatar from "@/components/layouts/user/user-avatar";
import UserBadge from "@/components/layouts/user/user-badge";
import { toast } from "@/lib/gooey-toast";
import { updateConversationPrefs } from "@/lib/messages/client";
import type {
  ConversationDetailResponse,
  ConversationPrefs,
} from "@/lib/messages/client";
import {
  CONVERSATION_THEMES,
  resolveConversationTheme,
} from "@/lib/messages/conversation-theme";
import type { SearchIndexStore } from "@/lib/messages/search-index-format";
import { cn, formatRelativeDate } from "@/lib/utils";
import { getSecureImageUrl } from "@/lib/utils/image-url";

import type { SharedContentMessage } from "./conversation-shared-content";
import { ConversationSharedLinksTab } from "./conversation-shared-links-tab";
import { ConversationSharedMediaTab } from "./conversation-shared-media-tab";
import { ConversationSharedPostsTab } from "./conversation-shared-posts-tab";
import type { ConversationMediaItem } from "./message-conversation-media";
import { useOpenConversationMedia } from "./message-media-viewer-context";
import { useSharedRefsReader } from "./use-shared-refs-reader";

type Peer = MessageConversationData["members"][number]["user"];

export interface ConversationDetailsBodyProps {
  // Whether this copy is the dialog's accessible name and description. The sheet
  // needs Radix's Title/Description so the dialog announces who it is about; the
  // pinned rail is a plain aside, where the same text is a heading and a
  // paragraph. Passing one flag rather than the two elements keeps the header's
  // markup and copy in a single place, which is the point of sharing it.
  asDialog?: boolean;
  detail: ConversationDetailResponse;
  indexingRefs: boolean;
  messages: readonly SharedContentMessage[];
  // Optional because the rail has nothing to close: it is pinned for as long as
  // the conversation is open. Every call site here is best-effort — a media tile
  // closes the sheet so the viewer is not stacked over it, and "View profile"
  // closes it so the sheet is gone when the thread unmounts. With no sheet, both
  // steps are simply not needed.
  onClose?: () => void;
  // Asks the thread to decrypt the loaded window, because a payload's type is
  // unknowable until it is decrypted and the decryptor's LRU only holds what the
  // transcript has recently needed. This is the FALLBACK source now: the tabs
  // normally read the local index, and this keeps them working when there is no
  // index to read.
  onRequestDecrypts: (messages: readonly MessageData[]) => void;
  // Brings a message into the loaded window, the same call the search results use.
  // Awaited by the media tab so the viewer opens on a window that really contains
  // the image.
  onJumpToMessage: (messageId: string) => Promise<void>;
  peer: Peer | undefined;
  presence: "idle" | "online" | null;
  // The local search index, which is where the tabs normally read from. Null when
  // the store has not resolved (or IndexedDB is unavailable), and the reader then
  // falls back to the decrypted window.
  searchIndexStore: SearchIndexStore | null;
  // Bumped by the thread whenever the index commits, so the tabs re-read what a
  // walk or a live message just wrote.
  refsRefreshToken: number;
  // The heading the thread focuses when the header's name button is pressed on a
  // viewport where the rail is already visible. `tabIndex={-1}` on the node
  // itself, because a heading is not a control and must not be one tab stop away.
  titleRef?: React.Ref<HTMLHeadingElement>;
}

// The conversation's contact card: who you are talking to, what you want to do
// about it, and everything the two of you have shared.
//
// The CONTENT, with no presentation of its own. It has two callers: the sheet,
// which is the whole surface below `lg`, and the rail that replaces the online
// friends list beside the transcript from `lg` up. They must never both be
// mounted (see detailsPlacement), because this component is where the reads and
// the cursors live.
//
// The three content tabs read the local refs index, which covers history the
// decryptor has long since evicted, and fall back to the decrypted window when
// there is no index to read at all. Each tab says which it is rather than
// claiming the conversation has nothing.
export function ConversationDetailsBody({
  asDialog = false,
  detail,
  indexingRefs,
  messages,
  onClose,
  onJumpToMessage,
  onRequestDecrypts,
  peer,
  presence,
  refsRefreshToken,
  searchIndexStore,
  titleRef,
}: ConversationDetailsBodyProps) {
  const conversationId = detail.conversation.id;
  const queryClient = useQueryClient();
  // True while a tile is being jumped to, so the tabs can hold the panel rather
  // than let the user act on a list that is about to be replaced underneath them.
  const [openingMedia, setOpeningMedia] = useState(false);
  // The mute switch is addressed by a label, and the id it hangs off was a
  // constant -- correct only while one copy of this content exists. A per-instance
  // id keeps the pairing right in a sheet, in a rail, and in a DOM that briefly
  // holds both during a resize.
  const muteId = useId();
  const theme = resolveConversationTheme(detail.prefs.themeKey);
  const openConversationMedia = useOpenConversationMedia();

  // Re-runs as history pages load, and only asks for rows the decryptor does not
  // already have. One batch on open, and a top-up as the thread pages in.
  useEffect(() => {
    onRequestDecrypts(messages as readonly MessageData[]);
  }, [messages, onRequestDecrypts]);

  // The tabs' single source of truth. Reads the local index, which covers history
  // the decryptor has long since evicted, and falls back to the decrypted window
  // when there is no index to read at all.
  const refs = useSharedRefsReader({
    conversationId,
    indexing: indexingRefs,
    messages,
    refreshToken: refsRefreshToken,
    store: searchIndexStore,
  });

  // Optimistic copy of the server's prefs: a write applies it immediately, and a
  // later refetch of the conversation detail replaces it with the server's
  // answer, which owns the mute timestamp (re-muting keeps the original one).
  // Resynced during render rather than in an effect, so a refetch that lands
  // while a write is in flight cannot start a second render pass.
  const [prefs, setPrefs] = useState<ConversationPrefs>(detail.prefs);
  const [syncedPrefs, setSyncedPrefs] = useState(detail.prefs);
  if (syncedPrefs !== detail.prefs) {
    setSyncedPrefs(detail.prefs);
    setPrefs(detail.prefs);
  }
  const muted = Boolean(prefs.mutedAt);

  const writePrefs = useCallback(
    async (
      patch: { muted?: boolean; themeKey?: string | null },
      optimistic: Partial<ConversationPrefs>
    ) => {
      const previous = prefs;
      // Written through to the conversation-detail cache as well as to local
      // state, because the thread owns that query: without this, closing and
      // reopening the pane would show the value from before the write (the
      // query's stale window is five minutes).
      const writeCache = (next: ConversationPrefs) => {
        queryClient.setQueryData<ConversationDetailResponse>(
          ["message-conversation", conversationId],
          (old) => (old ? { ...old, prefs: next } : old)
        );
      };
      setPrefs({ ...previous, ...optimistic });
      writeCache({ ...previous, ...optimistic });
      try {
        const saved = await updateConversationPrefs(conversationId, patch);
        setPrefs(saved);
        writeCache(saved);
        if (patch.muted !== undefined) {
          // The rail's bell icon and the badge it hides both come from the
          // conversation list, so a mute has to refresh it to be visible.
          void queryClient.invalidateQueries({
            queryKey: ["message-conversations"],
          });
        }
      } catch (error) {
        setPrefs(previous);
        writeCache(previous);
        toast({
          description:
            error instanceof Error
              ? error.message
              : "Couldn't save that change",
          title: "Setting not saved",
          variant: "destructive",
        });
      }
    },
    [conversationId, prefs, queryClient]
  );

  const handleMuteChange = useCallback(
    (checked: boolean) => {
      // The optimistic timestamp is replaced by the server's own, which is the
      // original mute time when re-muting an already muted chat.
      void writePrefs(
        { muted: checked },
        { mutedAt: checked ? new Date().toISOString() : null }
      );
    },
    [writePrefs]
  );

  const handleThemeChange = useCallback(
    (key: string) => {
      void writePrefs({ themeKey: key }, { themeKey: key });
    },
    [writePrefs]
  );

  // Hands the tile to the thread's own conversation-wide viewer, then steps out
  // of the way: two stacked modal surfaces would fight over the overlay and
  // focus, so the sheet closes and the viewer takes over.
  // The tile's message may be far outside the decrypted window: the refs index
  // covers the whole conversation, the transcript holds the last few pages. So the
  // tile asks the thread to jump to that message FIRST, which pages history in and
  // scrolls to it, and only then hands it to the viewer. Opening the viewer
  // immediately instead is the visible half of the bug: the viewer resolves its
  // anchor from the message, and for a tile from a page this device has not read
  // yet, it has nothing to anchor on and shows the wrong image or nothing at all.
  const handleOpenMedia = useCallback(
    async (item: ConversationMediaItem) => {
      setOpeningMedia(true);
      const jump = onJumpToMessage(item.messageId);
      // A failed jump must not strand the flag: the tile would refuse every
      // subsequent tap, and the panel would look wedged for the rest of the
      // session. The viewer is skipped in that case, because it anchors on a
      // message this device may not have paged in.
      const jumped = await jump.then(
        () => true,
        () => false
      );
      setOpeningMedia(false);
      if (!jumped) {
        return;
      }
      // Steps out of the way only where there is a sheet to step out of. Two
      // stacked modal surfaces fight over the overlay and focus; the rail is not
      // one, so the viewer opens over it and the rail is still there afterwards.
      onClose?.();
      openConversationMedia?.({
        imageIndex: item.imageIndex,
        messageId: item.messageId,
      });
    },
    [onClose, openConversationMedia, onJumpToMessage]
  );

  if (!peer) {
    return null;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <DetailsHeader
        asDialog={asDialog}
        muted={muted}
        mutedSince={prefs.mutedAt}
        peer={peer}
        presence={presence}
        theme={theme}
        titleRef={titleRef}
      />

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="px-4 pb-3">
          <div className="surface-3d divide-border/60 divide-y overflow-hidden rounded-2xl">
            <Link
              className="pill-3d-hover flex items-center gap-3 px-3.5 py-3"
              href={`/users/${peer.username}`}
              onClick={onClose}
            >
              <RowIcon icon={<UserRound className="size-4" />} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">View profile</span>
                <span className="text-muted-foreground block truncate text-xs">
                  @{peer.username}
                </span>
              </span>
              <ChevronRight className="text-muted-foreground size-4 shrink-0" />
            </Link>

            <div className="flex items-center gap-3 px-3.5 py-3">
              <RowIcon
                icon={
                  muted ? (
                    <BellOff className="size-4" />
                  ) : (
                    <Volume2 className="size-4" />
                  )
                }
              />
              <label className="min-w-0 flex-1" htmlFor={muteId}>
                <span className="block text-sm font-medium">Mute</span>
                <span className="text-muted-foreground block truncate text-xs">
                  {prefs.mutedAt
                    ? `${mutedSinceLabel(prefs.mutedAt)} · no unread badge`
                    : "Notifications and the unread badge"}
                </span>
              </label>
              <Switch
                checked={muted}
                id={muteId}
                onCheckedChange={handleMuteChange}
              />
            </div>

            <ThemeRow
              onChange={handleThemeChange}
              selectedKey={prefs.themeKey}
            />

            <ActionRow
              icon={<Ban className="size-4" />}
              label="Block"
              onClick={() => notifyNotWired("Blocking")}
              sublabel="Stop messages both ways"
              tone="destructive"
            />
            <ActionRow
              icon={<Flag className="size-4" />}
              label="Report"
              onClick={() => notifyNotWired("Reporting")}
              sublabel="Send this chat to moderation"
              tone="destructive"
            />
          </div>
        </div>

        <Tabs className="flex min-h-0 flex-1 flex-col" defaultValue="media">
          <div className="px-4 pb-2">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger className="gap-1.5 text-xs" value="media">
                Media
                <Count value={refs.counts.media} />
              </TabsTrigger>
              <TabsTrigger className="gap-1.5 text-xs" value="posts">
                Posts
                <Count value={refs.counts.post} />
              </TabsTrigger>
              <TabsTrigger className="gap-1.5 text-xs" value="links">
                Links
                <Count value={refs.counts.link} />
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent
            className="mt-0 min-h-0 flex-1 overflow-hidden"
            value="media"
          >
            <ConversationSharedMediaTab
              hasMore={
                refs.state === "indexed" &&
                refs.media.length < refs.counts.media
              }
              indexing={refs.state === "indexing"}
              items={refs.media}
              loadMore={refs.loadMoreMedia}
              onOpen={handleOpenMedia}
              opening={openingMedia}
              readError={refs.mediaError}
            />
          </TabsContent>
          <TabsContent
            className="mt-0 min-h-0 flex-1 overflow-hidden"
            value="posts"
          >
            <ConversationSharedPostsTab
              hasMore={
                refs.state === "indexed" && refs.posts.length < refs.counts.post
              }
              indexing={refs.state === "indexing"}
              items={refs.posts}
              loadMore={refs.loadMorePosts}
              readError={refs.postsError}
            />
          </TabsContent>
          <TabsContent
            className="mt-0 min-h-0 flex-1 overflow-hidden"
            value="links"
          >
            <ConversationSharedLinksTab
              hasMore={
                refs.state === "indexed" && refs.links.length < refs.counts.link
              }
              indexing={refs.state === "indexing"}
              items={refs.links}
              loadMore={refs.loadMoreLinks}
              readError={refs.linksError}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

// The details surface as a DIALOG: a side sheet from `sm` up and full-screen below,
// which is the whole surface wherever a phone has no room for a pane beside a
// transcript. From `lg` the thread renders the same content in a pinned rail
// instead, and never both — see detailsPlacement.
//
// A dialog and a rail differ in more than position: the sheet traps focus, closes
// on Escape and on an outside press, and has to name itself for a screen reader.
// All of that is Radix's, and all of it belongs to the wrapper rather than to the
// content, which is why the body below knows nothing about being modal.
export function ConversationDetailsPanel({
  onClose,
  ...props
}: ConversationDetailsBodyProps & { onClose: () => void }) {
  return (
    <Sheet onOpenChange={(open) => !open && onClose()} open>
      <SheetContent
        className="flex w-full flex-col gap-0 p-0 sm:max-w-md"
        side="right"
      >
        <ConversationDetailsBody asDialog onClose={onClose} {...props} />
      </SheetContent>
    </Sheet>
  );
}

// The conversation header. In the sheet it doubles as the dialog's accessible name,
// so the dialog announces who it is about; in the rail the same text is a heading
// and a paragraph, because a dialog's title wiring is meaningless outside one.
//
// The backdrop is the peer's own banner -- the same image their profile paints --
// and only when they have none does the chat accent stand in for it. That fallback
// is why `theme` is still a prop: a conversation whose peer never uploaded a header
// must not fall back to nothing, because a bare panel edge gives the pane no sense
// of being someone's place rather than a settings page.
function DetailsHeader({
  asDialog,
  muted,
  mutedSince,
  peer,
  presence,
  theme,
  titleRef,
}: {
  asDialog: boolean;
  muted: boolean;
  mutedSince: string | null;
  peer: Peer;
  presence: "idle" | "online" | null;
  theme: { from: string; to: string };
  titleRef?: React.Ref<HTMLHeadingElement>;
}) {
  // One markup, two elements. Both render an `h2` with the same classes, so the
  // heading looks and reads identically either way; only Radix's registration
  // differs.
  const name = (
    <>
      <span className="truncate">{peer.displayName ?? peer.username}</span>
      <UserBadge
        badge={peer.badge}
        badges={peer.badges}
        communityRoles={peer.communityMemberships}
      />
    </>
  );
  const description = (
    <>
      <span>@{peer.username}</span>
      {presence ? (
        <>
          <span aria-hidden>·</span>
          <span>{presence === "online" ? "Online now" : "Idle"}</span>
        </>
      ) : null}
      {muted ? (
        <span className="chip-3d inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium">
          <BellOff className="size-2.5" />
          {mutedSince ? mutedSinceLabel(mutedSince) : "Muted"}
        </span>
      ) : null}
    </>
  );

  // The banner fails the same way the profile page's does: it renders nothing and
  // the fallback paints through, rather than leaving a broken-image frame.
  const [bannerFailed, setBannerFailed] = useState(false);
  const bannerUrl = peer.bannerUrl && !bannerFailed ? peer.bannerUrl : null;

  return (
    // `pointer-events-none` because this block has no controls of its own and, in
    // the sheet, it is painted over the primitive's close button, which sits in
    // the same corner at `top-4 right-4`. Without this the X is visible but
    // unclickable.
    <div className="pointer-events-none relative shrink-0 overflow-hidden border-b border-[hsl(var(--border))]">
      {bannerUrl ? (
        // The peer's own header, full-bleed across the pane's top. A short
        // pane means a short crop, so the image is anchored to its centre-top
        // the way the profile page is: faces and logos live there, and a
        // centre crop is what cuts them off.
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 h-28 overflow-hidden"
        >
          <Image
            alt=""
            className="object-cover"
            fill
            onError={() => setBannerFailed(true)}
            sizes="(min-width: 1280px) 320px, 288px"
            src={getSecureImageUrl(bannerUrl)}
            unoptimized
          />
          {/* Two washes, both from the panel's own surface colour, so the image
              dissolves into the pane instead of ending on a crop line. This is
              the same brush the suggestion rows use, at portrait scale. */}
          <div className="absolute inset-0 bg-linear-to-b from-[hsl(var(--background-alt)/0.15)] via-transparent to-[hsl(var(--background-alt))]" />
          <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-b from-transparent to-[hsl(var(--background-alt))]" />
        </div>
      ) : (
        // No banner: the chat accent stands in. Inline rather than a styled class
        // because the colour is the member's stored theme, not a token the
        // stylesheet knows -- this is data, not a recipe.
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 -top-20 h-44"
          style={{
            background: `radial-gradient(70% 70% at 50% 55%, ${theme.from}38, transparent 70%)`,
          }}
        />
      )}

      <div className="relative flex flex-col items-center px-6 pb-5 text-center">
        {/* Pulled up over the banner's bottom edge, the way the profile page
            hangs its avatar off its own banner. The ring is what separates the
            two images where they meet; without it the avatar reads as part of
            the banner's picture. */}
        <div className="relative -mt-10">
          <UserAvatar
            avatarUrl={peer.avatarUrl}
            className="ring-4 ring-[hsl(var(--background))]"
            size={96}
          />
          {presence ? (
            <span
              className={cn(
                "absolute right-1 bottom-1 size-5 rounded-full border-4 ring-[hsl(var(--background))]",
                presence === "online" ? "bg-green-500" : "bg-amber-500"
              )}
            />
          ) : null}
        </div>

        {asDialog ? (
          <SheetTitle
            className="mt-3 flex max-w-full items-center gap-1.5 text-lg font-semibold tracking-tight"
            ref={titleRef}
          >
            {name}
          </SheetTitle>
        ) : (
          // Focusable without being a tab stop: the thread focuses this heading
          // when the header's name button is pressed on a viewport where this
          // pane is already visible, and a heading that cannot take focus would
          // make that press a no-op.
          <h2
            className="mt-3 flex max-w-full items-center gap-1.5 text-lg font-semibold tracking-tight"
            ref={titleRef}
            tabIndex={-1}
          >
            {name}
          </h2>
        )}

        {asDialog ? (
          <SheetDescription className="mt-1 flex flex-wrap items-center justify-center gap-1.5 text-xs">
            {description}
          </SheetDescription>
        ) : (
          <p className="mt-1 flex flex-wrap items-center justify-center gap-1.5 text-xs">
            {description}
          </p>
        )}
      </div>
    </div>
  );
}

// The theme row: a collapsed summary that expands into the swatch grid. Inline
// rather than a popover so it cannot fight the sheet for a portal, and so a
// choice previews itself in place.
function ThemeRow({
  onChange,
  selectedKey,
}: {
  onChange: (key: string) => void;
  selectedKey: string | null;
}) {
  const [open, setOpen] = useState(false);
  const selected = resolveConversationTheme(selectedKey);

  return (
    <div>
      <button
        aria-expanded={open}
        className="pill-3d-hover flex w-full items-center gap-3 px-3.5 py-3 text-left"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <RowIcon icon={<Palette className="size-4" />} />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">Chat theme</span>
          <span className="text-muted-foreground block truncate text-xs">
            Colours your own messages
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span
            aria-hidden
            className="size-5 rounded-full"
            style={{
              backgroundImage: `linear-gradient(to bottom, ${selected.from}, ${selected.to})`,
              boxShadow: `inset 0 1px 1px rgba(255,255,255,0.5), 0 0 0 1px ${selected.ring}`,
            }}
          />
          <span className="text-muted-foreground text-xs">
            {selected.label}
          </span>
          <ChevronRight
            className={cn(
              "text-muted-foreground size-4 transition-transform duration-200",
              open && "rotate-90"
            )}
          />
        </span>
      </button>

      {open ? (
        <div className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1 grid grid-cols-3 gap-2 px-3.5 pt-1 pb-3.5 motion-safe:duration-200">
          {CONVERSATION_THEMES.map((option) => (
            <ThemeSwatch
              isSelected={option.key === selected.key}
              key={option.key}
              label={option.label}
              onSelect={onChange}
              theme={option}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ThemeSwatch({
  isSelected,
  label,
  onSelect,
  theme,
}: {
  isSelected: boolean;
  label: string;
  onSelect: (key: string) => void;
  theme: { from: string; key: string; ring: string; to: string };
}) {
  return (
    <button
      aria-pressed={isSelected}
      className="pill-3d-hover flex flex-col items-center gap-1.5 rounded-xl px-2 py-2.5"
      onClick={() => onSelect(theme.key)}
      type="button"
    >
      <span
        className="flex size-8 items-center justify-center rounded-full"
        style={{
          backgroundImage: `linear-gradient(to bottom, ${theme.from}, ${theme.to})`,
          boxShadow: isSelected
            ? `inset 0 1px 1px rgba(255,255,255,0.5), 0 0 0 2px ${theme.ring}, 0 0 0 4px hsl(var(--background))`
            : `inset 0 1px 1px rgba(255,255,255,0.4), 0 0 0 1px ${theme.ring}`,
        }}
      >
        {isSelected ? (
          <Check className="size-4 text-white drop-shadow" strokeWidth={3} />
        ) : null}
      </span>
      <span className="text-muted-foreground text-[10px] font-medium">
        {label}
      </span>
    </button>
  );
}

function ActionRow({
  icon,
  label,
  onClick,
  sublabel,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  sublabel: string;
  tone?: "destructive";
}) {
  return (
    <button
      className="pill-3d-hover flex w-full items-center gap-3 px-3.5 py-3 text-left"
      onClick={onClick}
      type="button"
    >
      <RowIcon icon={icon} tone={tone} />
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block text-sm font-medium",
            tone === "destructive" && "text-destructive"
          )}
        >
          {label}
        </span>
        <span className="text-muted-foreground block truncate text-xs">
          {sublabel}
        </span>
      </span>
    </button>
  );
}

function RowIcon({
  icon,
  tone,
}: {
  icon: React.ReactNode;
  tone?: "destructive";
}) {
  return (
    <span
      className={cn(
        "chip-3d flex size-8 shrink-0 items-center justify-center rounded-xl",
        tone === "destructive" && "text-destructive"
      )}
    >
      {icon}
    </span>
  );
}

function Count({ value }: { value: number }) {
  if (value === 0) {
    return null;
  }
  return (
    <span className="text-muted-foreground text-[10px] font-semibold tabular-nums">
      {value}
    </span>
  );
}

// "Muted 5m ago", but "Muted just now" — formatRelativeDate already resolves
// the freshest case to a phrase, and appending "ago" to it reads as a stutter.
// The unparseable case drops the timestamp rather than claiming "Muted Invalid
// date ago". Same rule as the bubble's edited marker.
function mutedSinceLabel(mutedAt: string): string {
  const relative = formatRelativeDate(mutedAt);
  if (relative === "just now") {
    return "Muted just now";
  }
  if (relative === "Invalid date") {
    return "Muted";
  }
  return `Muted ${relative} ago`;
}

// Block and Report are presented but deliberately not wired: no moderation
// endpoint backs them yet. Rather than pretend the action happened (or silently
// block someone against the real /api/messages/blocks the user did not ask for),
// each says plainly that it is not connected.
function notifyNotWired(action: string) {
  toast({
    description: `${action} isn't connected yet. Nothing was sent or changed.`,
    title: "Not available yet",
    variant: "destructive",
  });
}
