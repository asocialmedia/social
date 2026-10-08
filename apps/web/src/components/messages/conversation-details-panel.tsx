"use client";

import type { DenRole } from "@asm/db/messages/dens";
import { DrawerDescription, DrawerTitle } from "@asm/ui/shadui/drawer";
import { Slider } from "@asm/ui/shadui/slider";
import { Switch } from "@asm/ui/shadui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@asm/ui/shadui/tabs";
import { useQueryClient } from "@tanstack/react-query";
import {
  Ban,
  BellOff,
  Check,
  ChevronRight,
  Flag,
  ImageIcon,
  Palette,
  Trash2,
  Upload,
  UserRound,
  Volume2,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type React from "react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import { useSession } from "@/app/(main)/session-provider";
import Spinner3D from "@/components/layouts/feedback/spinner-3d";
import UserAvatar from "@/components/layouts/user/user-avatar";
import UserBadge from "@/components/layouts/user/user-badge";
import { ConversationDetailsDrawer } from "@/components/messages/conversation-details-drawer";
import { toast } from "@/lib/gooey-toast";
import {
  rejectionCopy,
  uploadMediaFile,
} from "@/lib/media/media-upload-client";
import type { UploadStage } from "@/lib/media/media-upload-client";
import {
  ACCESS_ENDED_DESCRIPTION,
  ACCESS_ENDED_MESSAGE,
} from "@/lib/messages/access-ended";
import {
  clearConversationWallpaperUpload,
  readImageDimensions,
  setConversationWallpaperUpload,
  updateConversationPrefs,
} from "@/lib/messages/client";
import type {
  ConversationDetailResponse,
  ConversationPrefs,
} from "@/lib/messages/client";
import {
  CONVERSATION_THEMES,
  resolveConversationTheme,
} from "@/lib/messages/conversation-theme";
import {
  CONVERSATION_WALLPAPERS,
  MAX_WALLPAPER_DIM,
  MIN_WALLPAPER_DIM,
  resolveConversationWallpaper,
  resolveWallpaperDim,
  wallpaperDimOverlay,
} from "@/lib/messages/conversation-wallpaper";
import {
  checkWallpaperUpload,
  WALLPAPER_ACCEPT,
  wallpaperMimeFor,
} from "@/lib/messages/conversation-wallpaper-upload";
import { denMemberCountLabel } from "@/lib/messages/den-label";
import { denRoleLabel } from "@/lib/messages/den-permissions";
import { hasDeparted, ownMembership } from "@/lib/messages/membership";
import type { SearchIndexStore } from "@/lib/messages/search-index-format";
import type {
  MessageConversationData,
  MessageData,
} from "@/lib/messages/types";
import { cn, formatRelativeDate } from "@/lib/utils";
import { getSecureImageUrl } from "@/lib/utils/image-url";

import type { SharedContentMessage } from "./conversation-shared-content";
import { ConversationSharedLinksTab } from "./conversation-shared-links-tab";
import { ConversationSharedMediaTab } from "./conversation-shared-media-tab";
import { ConversationSharedPostsTab } from "./conversation-shared-posts-tab";
import { DenAvatarCollage } from "./den-avatar-collage";
import { DenAboutCard, DenPanel } from "./den-panel";
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
  onSelectedTabChange?: (tab: string) => void;
  selectedTab?: string;
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
  onSelectedTabChange,
  peer,
  presence,
  refsRefreshToken,
  selectedTab,
  searchIndexStore,
}: ConversationDetailsBodyProps) {
  const conversationId = detail.conversation.id;
  const queryClient = useQueryClient();
  // True while a tile is being jumped to, so the tabs can hold the panel rather
  // than let the user act on a list that is about to be replaced underneath them.
  const [openingMedia, setOpeningMedia] = useState(false);
  const [denActionsContainer, setDenActionsContainer] =
    useState<HTMLDivElement | null>(null);
  // The mute switch is addressed by a label, and the id it hangs off was a
  // constant -- correct only while one copy of this content exists. A per-instance
  // id keeps the pairing right in a sheet, in a rail, and in a DOM that briefly
  // holds both during a resize.
  const muteId = useId();
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
  // The dim slider's in-flight value. Radix reports every step of a drag but
  // commits once, when the thumb is released, so this is what the thumb and the
  // level label follow while the write is still pending. Deliberately kept OUT of
  // `prefs`: that state is the last server-confirmed value and is what
  // `writePrefs` rolls back to, so folding an uncommitted value in would leave a
  // rejected write with nothing to roll back to.
  const [pendingDim, setPendingDim] = useState<number | null>(null);
  if (syncedPrefs !== detail.prefs) {
    setSyncedPrefs(detail.prefs);
    setPrefs(detail.prefs);
  }
  const muted = Boolean(prefs.mutedAt);
  const wallpaperDim = pendingDim ?? prefs.wallpaperDim;

  // The server's answer is the one true version of the row, so it is what local
  // state AND the shared cache are set from. Written through to the cache as
  // well as to state, because the thread owns that query: without this, closing
  // and reopening the pane would show the value from before the write (the
  // query's stale window is five minutes).
  const applyServerPrefs = useCallback(
    (next: ConversationPrefs) => {
      setPrefs(next);
      queryClient.setQueryData<ConversationDetailResponse>(
        ["message-conversation", conversationId],
        (old) => (old ? { ...old, prefs: next } : old)
      );
    },
    [conversationId, queryClient]
  );

  // Refetch after a failure that had no optimistic write to undo. The wallpaper
  // upload and removal paths only touch the cache once the server has answered,
  // so there is no snapshot to restore and a failure can still have landed
  // server-side; a refetch is what makes the row tell the truth again.
  const resyncAfterFailure = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: ["message-conversation", conversationId],
    });
  }, [conversationId, queryClient]);

  const writePrefs = useCallback(
    async (
      patch: {
        muted?: boolean;
        themeKey?: string | null;
        wallpaperDim?: number | null;
        wallpaperKey?: string | null;
      },
      optimistic: Partial<ConversationPrefs>
    ) => {
      const previous = prefs;
      applyServerPrefs({ ...previous, ...optimistic });
      try {
        const saved = await updateConversationPrefs(conversationId, patch);
        applyServerPrefs(saved);
        if (patch.muted !== undefined) {
          // The rail's bell icon and the badge it hides both come from the
          // conversation list, so a mute has to refresh it to be visible.
          void queryClient.invalidateQueries({
            queryKey: ["message-conversations"],
          });
        }
      } catch (error) {
        applyServerPrefs(previous);
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
    [applyServerPrefs, conversationId, prefs, queryClient]
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

  // Null clears the override, which the resolver turns back into the app
  // default. Accepting it here is what makes the row's Solid tile a real escape
  // hatch rather than a no-op.
  const handleWallpaperChange = useCallback(
    (key: string | null) => {
      void writePrefs({ wallpaperKey: key }, { wallpaperKey: key });
    },
    [writePrefs]
  );

  // Removes the custom upload, returning to the preset the member had or to no
  // wallpaper at all. The server schedules the freed image for cleanup.
  const handleWallpaperRemove = useCallback(async () => {
    try {
      applyServerPrefs(await clearConversationWallpaperUpload(conversationId));
    } catch (error) {
      resyncAfterFailure();
      toast({
        description:
          error instanceof Error
            ? error.message
            : "Couldn't remove that wallpaper",
        title: "Couldn't Remove Wallpaper",
        variant: "destructive",
      });
    }
  }, [applyServerPrefs, conversationId, resyncAfterFailure]);

  // Uploading a custom wallpaper. Two phases, and the split matters: the bytes
  // go to the pipeline first (quarantine, scan, decode, derivatives), and only
  // once the server holds a finished image do we claim it. Nothing about the chat
  // changes until that claim succeeds, so a failed upload leaves no trace.
  const [uploadStage, setUploadStage] = useState<UploadStage | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);

  const handleWallpaperUpload = useCallback(
    async (file: File) => {
      // Client-side pre-flight, so an obvious mistake costs a millisecond instead
      // of an upload. This is a UX filter only: the browser can be told anything,
      // and the server re-checks every rule against what the decoder measured.
      const dimensions = await readImageDimensions(file);
      const check = checkWallpaperUpload({
        height: dimensions?.height ?? null,
        // The browser sometimes reports no type for a perfectly good file, so
        // fall back to the extension instead of refusing it.
        mimeType: wallpaperMimeFor(file.type, file.name),
        sizeBytes: file.size,
        width: dimensions?.width ?? null,
      });
      if (!check.ok) {
        toast({
          description: check.rejection.message,
          title: wallpaperRejectionTitle(check.rejection.kind),
          variant: "destructive",
        });
        return;
      }

      setUploadStage("uploading");
      setUploadProgress(0);
      try {
        const upload = await uploadMediaFile(file, {
          height: dimensions?.height,
          onProgress: (percent) => setUploadProgress(percent),
          onStage: setUploadStage,
          purpose: "wallpaper",
          width: dimensions?.width,
        });
        if (upload.status === "REJECTED") {
          // The pipeline refused it: a virus, a format the scanner will not
          // accept, or a mismatch between the bytes and what was claimed.
          toast({
            description: rejectionCopy(upload.rejectedReason),
            title: "Upload Rejected",
            variant: "destructive",
          });
        } else {
          applyServerPrefs(
            await setConversationWallpaperUpload(conversationId, upload.mediaId)
          );
        }
      } catch (error) {
        resyncAfterFailure();
        toast({
          description:
            error instanceof Error
              ? error.message
              : "Couldn't upload that image",
          title: "Upload Failed",
          variant: "destructive",
        });
      }
      // Unconditional, and reached by every path above including the rejection:
      // the React Compiler cannot lower a `try`/`finally`, so the reset lives
      // here, and no branch may return early and leave the tile spinning.
      setUploadStage(null);
      setUploadProgress(0);
    },
    [applyServerPrefs, conversationId, resyncAfterFailure]
  );

  // Every step of a drag. The transcript paints from the conversation-detail
  // cache, so writing the dragged value there is what makes the chat darken
  // under the thumb instead of snapping once at the end. No request is made yet:
  // a drag crosses a hundred values and must not send a hundred PATCHes.
  const handleDimChange = useCallback(
    (level: number) => {
      setPendingDim(level);
      queryClient.setQueryData<ConversationDetailResponse>(
        ["message-conversation", conversationId],
        (old) =>
          old ? { ...old, prefs: { ...old.prefs, wallpaperDim: level } } : old
      );
    },
    [conversationId, queryClient]
  );

  // Called when the thumb is released, and once per keyboard step. Radix commits
  // at exactly the moment a gesture is finished, so this is the write point: one
  // PATCH for the whole drag, not one per intermediate value.
  const handleDimCommit = useCallback(
    (level: number) => {
      setPendingDim(null);
      void writePrefs({ wallpaperDim: level }, { wallpaperDim: level });
    },
    [writePrefs]
  );

  // A drag that is interrupted rather than released, by the sheet closing or the
  // rail collapsing under the pointer, never reaches the commit above. Without
  // this the cache would keep showing a dim the server never took, and nothing
  // would correct it for the query's whole stale window. The commit path clears
  // the ref, so this only ever flushes a value that was genuinely left in flight.
  const undrainedDim = useRef<number | null>(null);
  useEffect(() => {
    undrainedDim.current = pendingDim;
  }, [pendingDim]);
  useEffect(
    () => () => {
      const level = undrainedDim.current;
      if (level !== null) {
        void updateConversationPrefs(conversationId, { wallpaperDim: level });
      }
    },
    [conversationId]
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

  // A den has no single peer, so `peer` is null for one by construction (see the
  // caller) and the whole contact card below is DM-only. What a den gets instead
  // is its own header plus DenPanel; the per-member preferences underneath are
  // identical either way, because mute, theme and wallpaper belong to the member
  // rather than to the pair.
  const isDen = detail.conversation.type === "DEN";
  const defaultTab = isDen ? "members" : "settings";
  const [tab, setTab] = useState<string>(defaultTab);
  const handleTabChange = useCallback(
    (nextTab: string) => {
      setTab(nextTab);
      onSelectedTabChange?.(nextTab);
    },
    [onSelectedTabChange]
  );

  // Sync default tab if the opened conversation changes
  const [syncedConversationId, setSyncedConversationId] =
    useState(conversationId);
  if (syncedConversationId !== conversationId) {
    setSyncedConversationId(conversationId);
    setTab(defaultTab);
  }
  const { user } = useSession();
  const myUserId = user?.id ?? "";
  // The viewer's own row, and the `leftAt` on it. Read here rather than fetched:
  // the sheet is already holding the whole conversation, and this fact changes the
  // same way membershipSeq does - the stream announces a removal, the thread
  // refetches the detail, and this follows. `hasDeparted` is the shared reading of
  // "left", so this sheet and the transcript's composer cannot disagree about it.
  const hasLeftDen =
    isDen && hasDeparted(ownMembership(detail.conversation.members, myUserId));

  // Somebody who left this den. Kept in the rail, kept readable, and offered none
  // of this sheet: the roster, the invite code, the mute, the theme and the
  // wallpaper are all writes, and every one of them is refused for them. Drawing
  // the controls anyway would be a sheet of switches that all fail, which reads
  // as a bug rather than as the consequence of leaving.
  const denHeader = useMemo(
    () =>
      isDen
        ? {
            avatarMediaId: detail.conversation.avatarMediaId ?? null,
            members: detail.conversation.members
              .filter((member) => !hasDeparted(member))
              .map((member) => ({
                avatarUrl: member.user.avatarUrl,
                displayName: member.user.displayName,
                id: member.userId,
                // The fallback is a sort key, not a name: this list is only
                // read by `denAvatarFaces` to decide whose face leads the
                // stack, and a row with no stored role (a DM row) belongs at
                // the back. Nothing here renders a role.
                role: member.role ?? "MEMBER",
                username: member.user.username,
              })),
            myRole:
              detail.conversation.members.find(
                (member) => member.userId === myUserId
              )?.role ?? null,
            myUserId,
            name: detail.conversation.name ?? null,
          }
        : null,
    [detail.conversation, isDen, myUserId]
  );

  if (hasLeftDen) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <DetailsHeader
          asDialog={asDialog}
          den={denHeader}
          muted={false}
          mutedSince={null}
          peer={peer}
          presence={presence}
        />
        <div className="max-h-[45dvh] shrink-0 overflow-y-auto px-4 pb-3">
          <div className="surface-3d rounded-2xl px-3.5 py-3">
            <p className="text-sm font-medium">{ACCESS_ENDED_MESSAGE}</p>
            <p className="text-muted-foreground mt-1 text-xs">
              {ACCESS_ENDED_DESCRIPTION} Everything said before you left is
              still here to read, and nothing you can do in this den changes
              that.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!peer && !isDen) {
    return null;
  }

  const requestedTab = selectedTab ?? tab;
  const activeTab =
    !isDen && requestedTab === "members" ? "settings" : requestedTab;
  const totalMediaCount =
    refs.counts.media + refs.counts.post + refs.counts.link;

  const denPreferences = (
    <div className="surface-3d divide-border/60 divide-y overflow-hidden rounded-2xl">
      <div className="flex items-center gap-3 px-2.5 py-2">
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

      <ThemeRow onChange={handleThemeChange} selectedKey={prefs.themeKey} />

      <WallpaperRow
        onDimChange={handleDimChange}
        onDimCommit={handleDimCommit}
        onRemove={handleWallpaperRemove}
        onSelect={handleWallpaperChange}
        onUpload={handleWallpaperUpload}
        selectedDim={wallpaperDim}
        selectedKey={prefs.wallpaperKey}
        selectedMediaId={prefs.wallpaperMediaId}
        uploadProgress={uploadProgress}
        uploadStage={uploadStage}
      />
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <DetailsHeader
        asDialog={asDialog}
        den={denHeader}
        muted={muted}
        mutedSince={prefs.mutedAt}
        peer={peer}
        presence={presence}
      />

      {isDen ? (
        <div className="shrink-0 px-2.5 pb-3">
          <DenAboutCard conversationId={conversationId} />
          <div className="mt-3 empty:hidden" ref={setDenActionsContainer} />
        </div>
      ) : null}

      <Tabs
        className="flex min-h-0 flex-1 flex-col"
        onValueChange={handleTabChange}
        value={activeTab}
      >
        <div className="px-2.5 pb-2">
          <TabsList
            aria-label={isDen ? "Den details" : "Conversation details"}
            appearance="raised"
            className={cn(
              "grid h-auto min-h-11 w-full rounded-2xl!",
              isDen ? "grid-cols-3" : "grid-cols-2"
            )}
          >
            {isDen ? (
              <TabsTrigger
                appearance="raised"
                className="min-h-11 min-w-0 gap-1.5 rounded-xl px-2 text-sm"
                value="members"
              >
                Members
              </TabsTrigger>
            ) : null}
            {isDen ? null : (
              <TabsTrigger
                appearance="raised"
                className="min-h-11 min-w-0 gap-1.5 rounded-xl px-2 text-sm"
                value="settings"
              >
                Details
              </TabsTrigger>
            )}
            <TabsTrigger
              appearance="raised"
              className="min-h-11 min-w-0 gap-1.5 rounded-xl px-2 text-sm"
              value="media"
            >
              Media
              <Count value={totalMediaCount} />
            </TabsTrigger>
            {isDen ? (
              <TabsTrigger
                appearance="raised"
                className="min-h-11 min-w-0 gap-1.5 rounded-xl px-2 text-sm"
                value="settings"
              >
                Settings
              </TabsTrigger>
            ) : null}
          </TabsList>
        </div>

        {isDen ? (
          <div
            className={cn(
              "min-h-0 flex-1 flex-col",
              activeTab === "media" ? "hidden" : "flex"
            )}
          >
            <DenPanel
              actionsContainer={denActionsContainer}
              activeTab={activeTab === "settings" ? "settings" : "members"}
              conversationId={conversationId}
              onLeft={onClose}
              preferences={denPreferences}
            />
          </div>
        ) : (
          <TabsContent
            className="mt-0 min-h-0 flex-1 overflow-y-auto px-2.5 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))]"
            value="settings"
          >
            <div className="surface-3d divide-border/60 divide-y overflow-hidden rounded-2xl">
              {peer ? (
                <Link
                  className="pill-3d-hover flex items-center gap-3 px-2.5 py-2"
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
              ) : null}

              <div className="flex items-center gap-3 px-2.5 py-2">
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

              <WallpaperRow
                onDimChange={handleDimChange}
                onDimCommit={handleDimCommit}
                onRemove={handleWallpaperRemove}
                onSelect={handleWallpaperChange}
                onUpload={handleWallpaperUpload}
                selectedDim={wallpaperDim}
                selectedKey={prefs.wallpaperKey}
                selectedMediaId={prefs.wallpaperMediaId}
                uploadProgress={uploadProgress}
                uploadStage={uploadStage}
              />

              {peer ? (
                <>
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
                </>
              ) : null}
            </div>
          </TabsContent>
        )}

        <TabsContent
          className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden"
          value="media"
        >
          <Tabs className="flex min-h-0 flex-1 flex-col" defaultValue="media">
            <div className="px-2.5 pb-2">
              <TabsList
                appearance="raised"
                className="grid h-auto min-h-11 w-full grid-cols-3 rounded-2xl!"
              >
                <TabsTrigger
                  appearance="raised"
                  className="min-h-11 min-w-0 gap-1.5 rounded-xl px-2 text-sm"
                  value="media"
                >
                  Media
                  <Count value={refs.counts.media} />
                </TabsTrigger>
                <TabsTrigger
                  appearance="raised"
                  className="min-h-11 min-w-0 gap-1.5 rounded-xl px-2 text-sm"
                  value="posts"
                >
                  Posts
                  <Count value={refs.counts.post} />
                </TabsTrigger>
                <TabsTrigger
                  appearance="raised"
                  className="min-h-11 min-w-0 gap-1.5 rounded-xl px-2 text-sm"
                  value="links"
                >
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
        </TabsContent>
      </Tabs>
    </div>
  );
}

// Mobile details open partially, then snap to full height when dragged upward.
// The drawer owns gestures and dismissal; the body also serves the desktop rail.
export function ConversationDetailsPanel({
  onClose,
  ...props
}: ConversationDetailsBodyProps & { onClose: () => void }) {
  return (
    <ConversationDetailsDrawer onClose={onClose}>
      <ConversationDetailsBody asDialog onClose={onClose} {...props} />
    </ConversationDetailsDrawer>
  );
}

// The conversation header. In the sheet it doubles as the dialog's accessible name,
// so the dialog announces who it is about; in the rail the same text is a heading
// and a paragraph, because a dialog's title wiring is meaningless outside one.
//
// The banner is the peer's own, the one they picked in profile settings, rather
// than a decorative accent: this pane is the closest thing to their profile inside a
// chat, and an image they chose says more about who they are than a colour derived
// from a chat theme. It falls back exactly as the profile page does -- blurred
// avatar, then a gradient -- so a member with no banner still gets a header.
function DetailsHeader({
  asDialog,
  den,
  muted,
  mutedSince,
  peer,
  presence,
}: {
  asDialog: boolean;
  // Non-null for a den, null for a DM. One header for both, because the two must
  // agree about who this pane is about: a DM's header names the one other person,
  // a den's names the room and says how many are in it.
  den: {
    avatarMediaId: string | null;
    members: {
      avatarUrl: string | null;
      displayName: string;
      id: string;
      role: DenRole;
      username: string;
    }[];
    myRole: DenRole | null;
    myUserId: string;
    name: string | null;
  } | null;
  muted: boolean;
  mutedSince: string | null;
  peer: Peer | undefined;
  presence: "idle" | "online" | null;
}) {
  // A banner URL can 404 or be a revoked key, and an empty rectangle is worse than
  // the fallback. Same reasoning as the profile page, which tracks this too.
  const [bannerFailed, setBannerFailed] = useState(false);

  // One markup, two elements. Both render an `h2` with the same classes, so the
  // heading looks and reads identically either way; only Radix's registration
  // differs.
  const name = den ? (
    <span className="truncate">{den.name ?? "Unnamed den"}</span>
  ) : (
    <>
      <span className="truncate">{peer?.displayName ?? peer?.username}</span>
      <UserBadge
        badge={peer?.badge}
        badges={peer?.badges}
        communityRoles={peer?.communityMemberships}
      />
    </>
  );
  // The muted chip is shared: it describes the reader's own preference, so it
  // reads the same in a DM and in a den.
  const mutedChip = muted ? (
    <span className="chip-3d inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium">
      <BellOff className="size-2.5" />
      {mutedSince ? mutedSinceLabel(mutedSince) : "Muted"}
    </span>
  ) : null;
  const viewerRole = den?.myRole ? denRoleLabel(den.myRole) : null;
  const description = den ? (
    <>
      <span>{denMemberCountLabel(den.members.length)}</span>
      {viewerRole ? (
        <>
          <span aria-hidden>·</span>
          <span>{viewerRole}</span>
        </>
      ) : null}
      {mutedChip}
    </>
  ) : (
    <>
      <span>@{peer?.username}</span>
      {presence ? (
        <>
          <span aria-hidden>·</span>
          <span>{presence === "online" ? "Online now" : "Idle"}</span>
        </>
      ) : null}
      {mutedChip}
    </>
  );

  // The DM header uses the peer's banner, falling back to their avatar when none
  // is set. Dens use their warm room color field behind the member collage.
  const headerBannerUrl = peer?.bannerUrl ?? null;
  const fallbackAvatarUrl = peer?.avatarUrl ?? null;

  let banner: React.ReactNode;
  if (den) {
    banner = (
      <div className="absolute inset-0 bg-linear-to-br from-[#ff9500] via-[#e65500] to-[#8b2f00] opacity-80" />
    );
  } else if (headerBannerUrl && !bannerFailed) {
    banner = (
      <Image
        alt=""
        className="object-cover"
        fill
        onError={() => setBannerFailed(true)}
        sizes="(max-width: 1024px) 100vw, 320px"
        src={getSecureImageUrl(headerBannerUrl)}
        unoptimized
      />
    );
  } else if (fallbackAvatarUrl) {
    // Their own avatar, blurred past recognition into an ambient color field.
    // A light blur keeps the mascot readable and renders it twice, misaligned --
    // once sharp in the frame and once sliced across the banner -- which is the
    // "cutting" this header had before. The scale pushes the blur's softened
    // edges out of the crop so no light band survives at the banner's edge.
    banner = (
      <Image
        alt=""
        className="object-cover"
        fill
        sizes="(max-width: 1024px) 100vw, 320px"
        src={getSecureImageUrl(fallbackAvatarUrl)}
        style={{
          filter: "blur(28px) brightness(0.6) saturate(1.15)",
          transform: "scale(1.75)",
        }}
        unoptimized
      />
    );
  } else {
    banner = (
      <div className="absolute inset-0 bg-linear-to-br from-[#ff9500] via-[#e65500] to-[#8b2f00] opacity-80" />
    );
  }

  return (
    // `pointer-events-none` because this block has no controls of its own and, in
    // the sheet, it is painted over the primitive's close button, which sits in
    // the same corner at `top-4 right-4`. Without this the X is visible but
    // unclickable.
    //
    // No border under it: the banner already separates the header from what
    // follows, and a hairline on top of an image reads as a seam rather than as an
    // edge.
    <div className="pointer-events-none relative shrink-0 overflow-hidden">
      {/* `overflow-hidden` is load-bearing, not tidiness. The banner image is `fill`
          and scaled up so its blur has no visible edge, which means it is TALLER
          than this box (168px against 96px). Without clipping it bleeds out of the
          bottom, past the fade that is supposed to dissolve it, and reappears
          un-faded behind the avatar -- the same mascot rendered twice, once faded
          above and once raw below, with a hard line where the fade stops. */}
      <div className="bg-muted/20 relative h-24 overflow-hidden">
        {banner}
        {/* Fades the banner into the pane's own background, so the crop has no hard
            bottom edge. Full-strength at the very bottom, where there is no banner
            left to show. */}
        <div className="absolute inset-0 bg-linear-to-t from-[hsl(var(--background))] to-transparent" />
      </div>

      <div className="relative -mt-12 px-2.5 pb-3">
        <div className="flex min-w-0 items-center gap-3">
          {den ? (
            <DenAvatarCollage
              avatarMediaId={den.avatarMediaId}
              members={den.members}
              myUserId={den.myUserId}
              size={72}
            />
          ) : (
            <div className="relative shrink-0">
              <UserAvatar avatarUrl={peer?.avatarUrl ?? null} size={72} />
              {presence ? (
                <span
                  className={cn(
                    "absolute right-0.5 bottom-0.5 size-4 rounded-full border-4 ring-[hsl(var(--background))]",
                    presence === "online" ? "bg-green-500" : "bg-amber-500"
                  )}
                />
              ) : null}
            </div>
          )}
          <div className="min-w-0 flex-1">
            {asDialog ? (
              <DrawerTitle className="flex max-w-full min-w-0 items-center gap-1.5 text-left text-lg font-semibold tracking-tight">
                {name}
              </DrawerTitle>
            ) : (
              <h2 className="flex max-w-full min-w-0 items-center gap-1.5 text-left text-lg font-semibold tracking-tight">
                {name}
              </h2>
            )}
            {asDialog ? (
              <DrawerDescription className="text-muted-foreground mt-1 flex flex-wrap items-center gap-1.5 text-left text-xs">
                {description}
              </DrawerDescription>
            ) : (
              <p className="text-muted-foreground mt-1 flex flex-wrap items-center gap-1.5 text-left text-xs">
                {description}
              </p>
            )}
          </div>
        </div>
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
        className="pill-3d-hover flex w-full items-center gap-3 px-2.5 py-2 text-left"
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
        <div className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1 grid grid-cols-3 gap-2 px-2.5 pt-1 pb-2.5 motion-safe:duration-200">
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
      className="pill-3d-hover flex flex-col items-center gap-1.5 rounded-lg px-2.5 py-2"
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

// Radix reports the whole array even for a single-thumb slider, so the value is
// its first entry. A mis-shaped event must not reach the stored preference,
// hence the type check.
function sliderLevel(next: number[]): number | null {
  const [level] = next;
  return typeof level === "number" ? level : null;
}

// The wallpaper row: the same collapsible shape as the theme row, plus the dim
// control. Inline rather than a popover for the reason the theme row is: a
// popover here would fight the sheet for a portal, and picking a wallpaper is
// worth previewing in place. The dim slider is labelled by the same table the
// thread paints from, so a level can never read as one thing and look like
// another.
function WallpaperRow({
  onDimChange,
  onDimCommit,
  onRemove,
  onSelect,
  onUpload,
  selectedDim,
  selectedKey,
  selectedMediaId,
  uploadProgress,
  uploadStage,
}: {
  onDimChange: (level: number) => void;
  onDimCommit: (level: number) => void;
  onRemove: () => void;
  onSelect: (key: string | null) => void;
  onUpload: (file: File) => void;
  selectedDim: number | null;
  selectedKey: string | null;
  selectedMediaId: string | null;
  uploadProgress: number;
  uploadStage: UploadStage | null;
}) {
  const [open, setOpen] = useState(false);
  // Null is the real default: no wallpaper, plain app background.
  const selected = resolveConversationWallpaper(selectedKey, selectedMediaId);
  const hasWallpaper = selected !== null;
  const isCustom = selected?.isCustom === true;
  // The one number the picker shows, the row stores and the transcript paints.
  const dim = resolveWallpaperDim(selectedDim);
  // The dim is a gradient OVER the art, never a background colour under it: an
  // opaque image paints on top of `background-color` and would hide the wash
  // completely, so the swatch would promise a dimmed result it never showed.
  const tileBackground = (src: string) => {
    const overlay = wallpaperDimOverlay(dim);
    return overlay
      ? `linear-gradient(${overlay}, ${overlay}), url(${src})`
      : `url(${src})`;
  };
  const uploading = uploadStage !== null;

  return (
    <div>
      <button
        aria-expanded={open}
        className="pill-3d-hover flex w-full items-center gap-3 px-2.5 py-2 text-left"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <RowIcon icon={<ImageIcon className="size-4" />} />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">Chat wallpaper</span>
          <span className="text-muted-foreground block truncate text-xs">
            {uploading
              ? uploadStageLabel(uploadStage, uploadProgress)
              : "Sits behind both sides' messages"}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span
            aria-hidden
            className={cn(
              "size-5 rounded-full bg-cover bg-center",
              !hasWallpaper && "bg-[hsl(var(--background))]"
            )}
            style={{
              // `backgroundImage` is typed as absent-or-string, so the Solid
              // tile's "no image" arrives here as undefined rather than null.
              backgroundImage: selected
                ? tileBackground(selected.src)
                : undefined,
              boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.25)",
            }}
          />
          <span className="text-muted-foreground text-xs">
            {selected?.label ?? "Solid"}
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
        <div className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1 px-2.5 pt-1 pb-2.5 motion-safe:duration-200">
          <div className="grid grid-cols-3 gap-2">
            <WallpaperSwatch
              background={null}
              isSelected={!hasWallpaper}
              label="Solid"
              onSelect={onSelect}
              wallpaperKey={null}
            />
            {CONVERSATION_WALLPAPERS.map((wallpaper) => (
              <WallpaperSwatch
                background={tileBackground(wallpaper.src)}
                // An upload takes precedence over the preset key, so the key's
                // tile must not also read as selected while an upload is set.
                isSelected={!isCustom && wallpaper.key === selectedKey}
                key={wallpaper.key}
                label={wallpaper.label}
                onSelect={onSelect}
                wallpaperKey={wallpaper.key}
              />
            ))}
            {isCustom && selected ? (
              <WallpaperSwatch
                background={tileBackground(selected.src)}
                isSelected
                label="Custom"
                onSelect={onSelect}
                // Already chosen; re-selecting is a no-op rather than a write.
                wallpaperKey={selectedKey}
              />
            ) : (
              <WallpaperUploadTile
                busy={uploading}
                onPick={onUpload}
                uploadProgress={uploadProgress}
              />
            )}
          </div>

          {/* Only with a wallpaper on screen. A dim over the plain background
              would darken the whole app's surface for no visible gain, and a
              control that changes nothing is worse than no control. The stored
              value is left alone, so picking a wallpaper back up restores it. */}
          {hasWallpaper ? (
            <>
              <div className="mt-3 flex items-center justify-between gap-3">
                <span className="text-sm font-medium">Dim</span>
                <span className="text-muted-foreground text-xs tabular-nums">
                  {dim}%
                </span>
              </div>
              <Slider
                className="mt-2"
                max={MAX_WALLPAPER_DIM}
                min={MIN_WALLPAPER_DIM}
                onValueChange={(next) => {
                  const level = sliderLevel(next);
                  if (level !== null) {
                    onDimChange(level);
                  }
                }}
                onValueCommit={(next) => {
                  const level = sliderLevel(next);
                  if (level !== null) {
                    onDimCommit(level);
                  }
                }}
                step={1}
                thumbLabel="Wallpaper dim"
                // The thumb announces the percentage rather than the raw index, so
                // the value a screen reader reads is the one shown on screen.
                thumbValueText={`${dim}%`}
                value={[dim]}
              />

              {/* Only an upload can be removed. A built-in preset is undone by
                  picking another one, and the Solid tile already means "none",
                  so a Remove button next to those would offer a second way to do
                  the same thing. */}
              {isCustom ? (
                <button
                  className="text-muted-foreground hover:text-foreground mt-3 inline-flex items-center gap-1.5 text-xs font-medium"
                  onClick={onRemove}
                  type="button"
                >
                  <Trash2 className="size-3.5" />
                  Remove this wallpaper
                </button>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// The toast title for a client-side pre-flight rejection, chosen by which rule
// failed so the member is told the category before the detail.
function wallpaperRejectionTitle(kind: "type" | "size" | "dimensions"): string {
  if (kind === "type") {
    return "Unsupported File";
  }
  if (kind === "size") {
    return "File Too Big";
  }
  return "Image Too Small";
}

// Progress copy for the upload, matching the vocabulary the profile avatar and
// banner uploads already use so the pipeline's stages read the same everywhere.
function uploadStageLabel(stage: UploadStage, progress: number): string {
  switch (stage) {
    case "uploading": {
      return `Uploading ${progress}%`;
    }
    case "queued": {
      return "Queued for processing";
    }
    case "scanning": {
      return "Scanning for threats…";
    }
    case "processing": {
      return "Preparing your wallpaper…";
    }
    default: {
      return "Processing…";
    }
  }
}

// The upload affordance, drawn as a tile so it sits in the same grid as the
// wallpapers it produces. The file input is visually hidden and driven by a
// label, so the whole tile is one large hit target and the control is reachable
// by keyboard for free.
function WallpaperUploadTile({
  busy,
  onPick,
  uploadProgress,
}: {
  busy: boolean;
  onPick: (file: File) => void;
  uploadProgress: number;
}) {
  return (
    <label className="pill-3d-hover flex cursor-pointer flex-col items-center gap-1.5 rounded-lg px-2.5 py-2">
      <span className="border-border/70 text-muted-foreground flex size-10 items-center justify-center rounded-lg border border-dashed">
        {busy ? (
          <Spinner3D className="size-4" />
        ) : (
          <Upload className="size-4" />
        )}
      </span>
      <span className="text-muted-foreground text-[10px] font-medium">
        {busy ? `${uploadProgress}%` : "Upload"}
      </span>
      <input
        accept={WALLPAPER_ACCEPT}
        className="sr-only"
        disabled={busy}
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Cleared unconditionally, so choosing the same file again still
          // fires a change event instead of silently doing nothing.
          event.target.value = "";
          if (file) {
            onPick(file);
          }
        }}
        type="file"
      />
    </label>
  );
}

function WallpaperSwatch({
  background,
  isSelected,
  label,
  onSelect,
  wallpaperKey,
}: {
  // Null means "no image here", which is what the Solid tile shows: the app
  // background, exactly as the transcript renders it with no wallpaper picked.
  background: string | null;
  isSelected: boolean;
  label: string;
  onSelect: (key: string | null) => void;
  // Null is the "no wallpaper" choice, which is the default and the only way
  // back to the plain background.
  wallpaperKey: string | null;
}) {
  return (
    <button
      aria-pressed={isSelected}
      className="pill-3d-hover flex flex-col items-center gap-1.5 rounded-lg px-2.5 py-2"
      onClick={() => onSelect(wallpaperKey)}
      type="button"
    >
      <span
        className={cn(
          "size-10 rounded-lg bg-cover bg-center",
          !background && "bg-[hsl(var(--background))]"
        )}
        style={{
          // Null means the Solid tile, which paints no image at all.
          backgroundImage: background ?? undefined,
          // The 3D inner lip on a dark thumbnail, matched to the theme swatch's
          // selected ring so the two rows read as the same control.
          boxShadow: isSelected
            ? "inset 0 0 0 1px rgba(255,255,255,0.35), 0 0 0 2px hsl(var(--primary)), 0 0 0 4px hsl(var(--background))"
            : "inset 0 0 0 1px rgba(255,255,255,0.2), 0 0 0 1px rgba(255,255,255,0.1)",
        }}
      />
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
      className="pill-3d-hover flex w-full items-center gap-3 px-2.5 py-2 text-left"
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
        "chip-3d flex size-8 shrink-0 items-center justify-center rounded-lg",
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
    <span className="text-[10px] font-semibold tabular-nums">{value}</span>
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
