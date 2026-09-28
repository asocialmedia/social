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
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

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

import type { SharedContentMessage } from "./conversation-shared-content";
import { ConversationSharedLinksTab } from "./conversation-shared-links-tab";
import { ConversationSharedMediaTab } from "./conversation-shared-media-tab";
import { ConversationSharedPostsTab } from "./conversation-shared-posts-tab";
import type { ConversationMediaItem } from "./message-conversation-media";
import { useOpenConversationMedia } from "./message-media-viewer-context";
import { useSharedRefsReader } from "./use-shared-refs-reader";

type Peer = MessageConversationData["members"][number]["user"];

// The conversation's contact card: who you are talking to, what you want to do
// about it, and everything the two of you have shared.
//
// Opened from the thread header (its avatar/name button), it is a side sheet on
// desktop and a full-screen sheet on mobile — one surface, because a phone has
// no room for a pane beside a transcript.
//
// The three content tabs are all built from the transcript this client has
// decrypted so far, the same constraint the fullscreen media viewer works under:
// a payload's type is unknowable until its ciphertext is decrypted, so the lists
// grow as history pages load. Each tab says so when it is empty rather than
// claiming the conversation has nothing.
export function ConversationDetailsPanel({
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
}: {
  detail: ConversationDetailResponse;
  messages: readonly SharedContentMessage[];
  onClose: () => void;
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
  // A backfill walk is running, so the tabs can say "indexing" instead of
  // implying the list is the whole conversation.
  indexingRefs: boolean;
}) {
  const conversationId = detail.conversation.id;
  const queryClient = useQueryClient();
  // True while a tile is being jumped to, so the tabs can hold the panel rather
  // than let the user act on a list that is about to be replaced underneath them.
  const [openingMedia, setOpeningMedia] = useState(false);
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
      onClose();
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
    <Sheet onOpenChange={(open) => !open && onClose()} open>
      <SheetContent
        className="flex w-full flex-col gap-0 p-0 sm:max-w-md"
        side="right"
      >
        <Header
          muted={muted}
          mutedSince={prefs.mutedAt}
          peer={peer}
          presence={presence}
          theme={theme}
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
                  <span className="block text-sm font-medium">
                    View profile
                  </span>
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
                <label className="min-w-0 flex-1" htmlFor="dm-mute">
                  <span className="block text-sm font-medium">Mute</span>
                  <span className="text-muted-foreground block truncate text-xs">
                    {prefs.mutedAt
                      ? `${mutedSinceLabel(prefs.mutedAt)} · no unread badge`
                      : "Notifications and the unread badge"}
                  </span>
                </label>
                <Switch
                  checked={muted}
                  id="dm-mute"
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
                  refs.state === "indexed" &&
                  refs.posts.length < refs.counts.post
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
                  refs.state === "indexed" &&
                  refs.links.length < refs.counts.link
                }
                indexing={refs.state === "indexing"}
                items={refs.links}
                loadMore={refs.loadMoreLinks}
                readError={refs.linksError}
              />
            </TabsContent>
          </Tabs>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// The conversation header, doubling as the sheet's accessible name so the dialog
// announces who it is about. The bloom behind the avatar is the chat accent, so
// the pane shows the theme it is describing.
function Header({
  muted,
  mutedSince,
  peer,
  presence,
  theme,
}: {
  muted: boolean;
  mutedSince: string | null;
  peer: Peer;
  presence: "idle" | "online" | null;
  theme: { from: string; to: string };
}) {
  return (
    // `pointer-events-none` because this block has no controls of its own and it
    // is painted over the primitive's close button, which sits in the same
    // corner at `top-4 right-4`. Without this the X is visible but unclickable.
    <div className="pointer-events-none relative shrink-0 overflow-hidden border-b border-[hsl(var(--border))]">
      {/* Inline rather than a styled class because the colour is the member's
          stored theme, not a token the stylesheet knows: this is data, not a
          recipe, so it cannot live in `@layer components`. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-24 h-56"
        style={{
          background: `radial-gradient(60% 60% at 50% 60%, ${theme.from}40, transparent 72%)`,
        }}
      />
      <div className="relative flex flex-col items-center px-6 pt-7 pb-5 text-center">
        <div className="relative">
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

        <SheetTitle className="mt-3 flex max-w-full items-center gap-1.5 text-lg font-semibold tracking-tight">
          <span className="truncate">{peer.displayName ?? peer.username}</span>
          <UserBadge
            badge={peer.badge}
            badges={peer.badges}
            communityRoles={peer.communityMemberships}
          />
        </SheetTitle>

        <SheetDescription className="mt-1 flex flex-wrap items-center justify-center gap-1.5 text-xs">
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
        </SheetDescription>
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
