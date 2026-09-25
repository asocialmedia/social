"use client";

import type { MessageData, MessagePage } from "@asm/db";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { InfiniteData } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowDown,
  ArrowLeft,
  Check,
  KeyRound,
  Loader2,
  Search,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useSession } from "@/app/(main)/session-provider";
import UserAvatar from "@/components/layouts/user/user-avatar";
import UserBadge from "@/components/layouts/user/user-badge";
import { MessageBubble } from "@/components/messages/message-bubble";
import { MessageComposer } from "@/components/messages/message-composer";
import {
  mediaFlatKey,
  messageIdFromFlatKey,
} from "@/components/messages/message-conversation-media";
import { ConversationMediaViewer } from "@/components/messages/message-conversation-viewer";
import type { MediaNavDirection } from "@/components/messages/message-conversation-viewer";
import { MessageDeleteDialog } from "@/components/messages/message-delete-dialog";
import { useMessagesIdentity } from "@/components/messages/message-identity-provider";
import { ConversationMediaViewerProvider } from "@/components/messages/message-media-viewer-context";
import type { OpenConversationMedia } from "@/components/messages/message-media-viewer-context";
import { MessageOptionsMenu } from "@/components/messages/message-options-menu";
import { MessageSearchBar } from "@/components/messages/message-search-bar";
import type { SearchView } from "@/components/messages/message-search-bar";
import { MessageSearchResults } from "@/components/messages/message-search-results";
import { MessageThreadSkeleton } from "@/components/messages/messages-skeleton";
import { toast } from "@/lib/gooey-toast";
import {
  ackMessageDelivered,
  appendMessageToLastPage,
  deleteMessage,
  editMessage,
  fetchConversationDetail,
  fetchMessages,
  hideMessages,
  linkMessageMedia,
  markConversationRead,
  markMessagesDeletedInPages,
  reencryptMessageForEdit,
  removeMessagesFromPages,
  updateMessageInPages,
} from "@/lib/messages/client";
import type {
  ConversationDetailResponse,
  MessagePageAxis,
} from "@/lib/messages/client";
import type { MessagePayload } from "@/lib/messages/crypto";
import {
  editMessagePayload,
  exportPublicKeyJwk,
  generateFingerprint,
  getMediaImages,
  importPublicKeyJwk,
  importRatchetBaseKey,
  publicKeyBase64ToJwk,
} from "@/lib/messages/crypto";
import type { DecryptEntry, DecryptItem } from "@/lib/messages/decryptor";
import { messageDecryptor } from "@/lib/messages/decryptor";
import { isWithinEditWindow } from "@/lib/messages/edit-window";
import {
  chunkMessageIds,
  messageDeleteCopy,
} from "@/lib/messages/message-delete";
import type { MessageDeleteScope } from "@/lib/messages/message-delete";
import {
  applySelectionRange,
  dragSelectionMode,
  exceededSlop,
  selectionRange,
} from "@/lib/messages/message-gestures";
import type { PaneRect } from "@/lib/messages/message-gestures";
import { createMessageIndexBackfill } from "@/lib/messages/message-index-backfill";
import type { BackfillProgress } from "@/lib/messages/message-index-backfill";
import { createMessageIndexWriter } from "@/lib/messages/message-index-writer";
import type { PeerWatermarks } from "@/lib/messages/message-receipts";
import {
  advanceWatermark,
  EMPTY_WATERMARKS,
  getMessageReceipt,
  peerWatermarks,
} from "@/lib/messages/message-receipts";
import { paginateSearchResults } from "@/lib/messages/message-search";
import {
  formatArrivalCount,
  isNearBottom,
  jumpBehavior,
  nextArrivalCount,
  PINNED_THRESHOLD_PX,
} from "@/lib/messages/scroll-state";
import { resolveSearchIndexStore } from "@/lib/messages/search-index-backend";
import { planSearchIndexEviction } from "@/lib/messages/search-index-eviction";
import { useConversationSearch } from "@/lib/messages/use-conversation-search";
import { useDecryptEntry } from "@/lib/messages/use-decrypt-entry";
import {
  findMyWrappedKey,
  findMyWrappedKeys,
  findPeerPublicKey,
  useRootKeyStore,
} from "@/lib/messages/use-decryption";
import {
  useMessagesRealtime,
  shouldCatchUp,
} from "@/lib/messages/use-messages-realtime";
import { usePresence } from "@/lib/messages/use-presence";
import { createViewerScanCache } from "@/lib/messages/viewer-scan-cache";
import { waitForDecrypts } from "@/lib/messages/wait-for-decrypts";
import { cn } from "@/lib/utils";
import { getMessageMediaId } from "@/lib/utils/image-url";

import { bubblePosition, bubbleRoundingClasses } from "./message-bubble-shape";
import { getMessageGroupMeta, formatTimeDivider } from "./message-grouping";
import type { MessageGroupMeta } from "./message-grouping";
import {
  pagesToDropForTranscriptHistory,
  pagesToDropForViewerHistory,
  trimOldestPages,
} from "./viewer-history-window";

interface MessageThreadProps {
  conversationId: string;
  onBack: () => void;
  onToggleRail: () => void;
}

// Estimated row height before measurement, and the exact height the decrypt
// skeleton is pinned to. Keeping the two equal means a pending row and a
// measured one start at the same size, so mounting a window of undecrypted
// history does not change the total extent (and therefore does not trigger the
// virtualizer's scroll compensation). Sits between a one-line bubble and a
// two-line one; measureElement corrects each row after decrypt.
const ESTIMATED_ROW_SIZE = 64;
// The decrypt window extends this many rows beyond the viewport each way;
// history outside it is not requested until scrolled near.
const DECRYPT_PREFETCH_ROWS = 64;
// Rows rendered beyond the viewport each way. Matches TanStack's chat example:
// enough that a normal fling does not outrun measurement, without mounting the
// large media subtrees (image, avatar, actions) that would slow each frame.
const ROW_OVERSCAN = 6;
// When the media viewer is open, decrypt this many transcript rows either side
// of the active image so adjacent media is discovered. Bounded, so a sparse
// conversation cannot make the viewer decrypt the whole history at once.
const VIEWER_DECRYPT_RADIUS = 40;
// Rows per history page. Large enough that a full-history walk (in-conversation
// search indexing, jump-to-message fallback) costs tens of round trips instead
// of hundreds; small enough that one page stays a few tens of kilobytes of
// ciphertext. Decrypt and render stay windowed regardless of page size.
const HISTORY_PAGE_SIZE = 100;

// Which way a transcript page was fetched. The transcript is an infinite query
// in both directions: it normally loads older history going down, and once a
// jump anchors the window mid-history it also has to grow upward. Reusing the
// shared axis type keeps the cursor chain type-safe without restating it.
type MessagesPageParam = MessagePageAxis;

// The page param the transcript starts from: the newest page.
const NEWEST_PAGE: MessagesPageParam = { kind: "older" };

type MessagesInfiniteData = InfiniteData<MessagePage, MessagesPageParam>;

// Backfill walk tuning. The page is the largest the API allows for a declared
// walk, so covering a conversation costs as few round trips as possible. Because
// the walk paces per REQUEST, a larger page is less server load for the same
// politeness, not more: measured at 200k messages, 500 rows/page cuts cover time
// from 11.1 minutes to 2.3.
const BACKFILL_PAGE_SIZE = 500;
const BACKFILL_PAGE_DELAY_MS = 250;
// How long to coalesce index writes during a walk before re-reading the row
// table. Without this, every committed page would trigger a full row-table read
// and a 25-page walk would cost 25 of them.
const COVERAGE_REFRESH_DEBOUNCE_MS = 1500;

export function MessageThread({
  conversationId,
  onBack,
  onToggleRail,
}: MessageThreadProps) {
  const { user } = useSession();
  const { privateKey } = useMessagesIdentity();
  const queryClient = useQueryClient();
  const rootKeyStore = useRootKeyStore();
  const onlineUsers = usePresence(true);

  const [replyTarget, setReplyTarget] = useState<{
    content?: string;
    id: string;
    senderId: string;
    senderName?: string;
  } | null>(null);
  // The message currently being edited, or null. Editing and replying are
  // mutually exclusive modes in the composer: entering one clears the other.
  const [editTarget, setEditTarget] = useState<{
    content: string;
    id: string;
    // Payload type drives whether an empty body is a valid edit: clearing a
    // text message would leave an empty bubble, but clearing a media/post
    // caption is a legitimate removal.
    payloadType: MessagePayload["type"];
  } | null>(null);
  const [peerTyping, setPeerTyping] = useState(false);
  // flatKey (`messageId:imageIndex`) of the image the conversation-wide viewer
  // is anchored on, or null when closed. Stored as a key, not an index, so
  // older pages prepending never shifts the current image.
  const [mediaViewerKey, setMediaViewerKey] = useState<string | null>(null);
  // Whether the viewport is pinned to the newest message, and how many peer
  // messages have arrived since it last was (the Telegram-style badge).
  const [pinnedToBottom, setPinnedToBottom] = useState(true);
  const [arrivalCount, setArrivalCount] = useState(0);
  // Chat search is one session with two view states. The search bar renders
  // differently per view and owns every control, so the thread holds the mode
  // plus the list's page and active row and routes one set of key handlers.
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchView, setSearchView] = useState<SearchView>("chat");
  const [searchPage, setSearchPage] = useState(0);
  const [searchListIndex, setSearchListIndex] = useState(0);
  // The local search index backend, resolved once per conversation. Null until
  // it resolves, and permanently null when IndexedDB is unavailable, in which
  // case search falls back to the rows loaded in this session.
  const [searchIndex, setSearchIndex] = useState<{
    refreshToken: number;
    store: Awaited<ReturnType<typeof resolveSearchIndexStore>>["store"];
  } | null>(null);
  // Owned here (not inside the bar) so the Ctrl+F shortcut can pull focus back
  // into the field while the results list holds it.
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  // The current match: persistent for as long as the query is, so the bar's
  // "n of N" counter and the stepper keep pointing at it after the flash ends.
  const [searchActiveId, setSearchActiveId] = useState<string | null>(null);
  // The shimmer target: transient (cleared by its own timer) and deliberately
  // separate from the current match, so the single sweep can expire without the
  // counter losing its position. The timer outlasts the 800ms animation by just
  // enough to cover it, then drops the layer.
  const [jumpTargetId, setJumpTargetId] = useState<string | null>(null);
  const jumpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const readDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mirrors `pinnedToBottom` for reads inside event callbacks without stale
  // closures. Kept in sync in one place (the scroll listener) so the two can
  // never disagree.
  const pinnedRef = useRef(true);
  // Remembers messages the viewer already decrypted to non-media, so repeated
  // navigation over an imageless stretch does not re-derive their keys. See
  // viewer-scan-cache.ts. Created once via useState for a stable identity that
  // is legal to read in callbacks.
  // eslint-disable-next-line react/hook-use-state -- one-time instance; the setter is intentionally unused
  const [viewerScanCache] = useState(() => createViewerScanCache());
  // Ids currently in flight for viewer discovery whose resolution will be
  // classified into the scan cache. Membership shrinks to empty as each lands.
  const pendingScanRef = useRef(new Set<string>());
  // Serializes older-page loads: the jump-to-oldest loop and the boundary
  // auto-loader both call through here, and concurrent fetchPreviousPage calls
  // would race the cursor. Deliberately a ref (not query state) so the awaited
  // jump loop never sees a stale `isFetching` closure and bails after one page.
  const loadingOlderRef = useRef(false);
  // True while the user is walking older history. The viewer's history trim is
  // suppressed during a walk, because dropping the freshly loaded pages would
  // make the walk retread the same ground (a load/trim loop). It resets when
  // the viewer moves newer, which is exactly when old pages become dead weight.
  const olderWalkRef = useRef(false);
  // The viewer's current media position, reported up so the thread can bound
  // loaded history. Only updates while the viewer is open and navigating, so it
  // never causes transcript re-renders during normal scrolling.
  const [viewerPosition, setViewerPosition] = useState({ index: 0, total: 0 });

  // Desktop options pane: the message it targets plus that message's bubble rect
  // in viewport coordinates. `preferEnd` puts own messages' pane on the left.
  const [optionsTarget, setOptionsTarget] = useState<{
    messageId: string;
    preferEnd: boolean;
    rect: PaneRect;
  } | null>(null);
  // Coarse-pointer devices (touch) get a bottom sheet instead of a side popover.
  // State (not just a ref) because it changes what is rendered; set in an effect
  // to avoid an SSR/client hydration mismatch.
  const [coarsePointer, setCoarsePointer] = useState(false);
  // Multi-select: the ticked message ids. `selectionActive` is explicit so an
  // empty selection can still be in select mode (the bulk bar stays mounted).
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  const [selectionActive, setSelectionActive] = useState(false);
  // A delete awaiting confirmation. Captured at request time (ids for "for me",
  // the row for "for everyone") so the confirm acts on exactly what the dialog
  // disclosed, even if the selection or cache changes while it is open. Kept
  // after close (not nulled) so the dialog stays mounted through its exit
  // animation and can restore focus to the invoker.
  const [pendingDelete, setPendingDelete] = useState<
    | { messageIds: string[]; scope: Extract<MessageDeleteScope, "for-me"> }
    | {
        message: MessageData;
        scope: Extract<MessageDeleteScope, "for-everyone">;
      }
    | null
  >(null);
  // Whether the confirmation is visible. Separate from `pendingDelete` so the
  // node can transition closed instead of unmounting.
  const [deleteOpen, setDeleteOpen] = useState(false);
  // True while the confirmed delete is in flight, so the dialog can show a busy
  // state and block a second confirm.
  const [deleteBusy, setDeleteBusy] = useState(false);
  // The peer's delivery/read watermarks, seeded from the conversation detail and
  // advanced by realtime events. Own-message receipts compare against these.
  const [peerMarks, setPeerMarks] = useState<PeerWatermarks>(EMPTY_WATERMARKS);
  // Gesture bookkeeping lives in refs so pointer moves never re-render the
  // window. `suppressClickRef` carries the drag verdict from pointerup to the
  // click that follows it.
  const pointerRef = useRef<{
    base: ReadonlySet<string>;
    index: number;
    messageId: string;
    mode: "add" | "remove";
    startX: number;
    startY: number;
    touch: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);
  // Highest peer message id already acked as delivered this session, so the
  // debounced effect does not re-POST the same watermark.
  const lastAckedIdRef = useRef<string | null>(null);
  // Desktop gestures are for fine pointers only. Touch devices keep the
  // in-bubble "..." menu and native scrolling; every gesture handler bails when
  // this is false.
  const finePointerRef = useRef(false);
  useEffect(() => {
    const query = window.matchMedia("(pointer: fine)");
    finePointerRef.current = query.matches;
    setCoarsePointer(!query.matches);
    const onChange = (event: MediaQueryListEvent) => {
      finePointerRef.current = event.matches;
      setCoarsePointer(!event.matches);
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const { data: detail } = useQuery({
    queryFn: () => fetchConversationDetail(conversationId),
    queryKey: ["message-conversation", conversationId],
    // Keys/membership are stable for a thread's lifetime; the composer
    // invalidates this explicitly after it posts new wrapped keys.
    staleTime: 5 * 60 * 1000,
  });

  const messagesQuery = useInfiniteQuery<
    MessagePage,
    Error,
    MessagesInfiniteData,
    readonly [string, string],
    MessagesPageParam
  >({
    // Newer messages normally arrive over the SSE stream, so the newest read has
    // no next page. After an anchored jump the window sits mid-history and
    // carries a nextCursor, and growing upward is what keeps the transcript
    // coherent when the user scrolls toward the present.
    getNextPageParam: (firstPage) =>
      firstPage.nextCursor
        ? { cursor: firstPage.nextCursor, kind: "newer" }
        : undefined,
    getPreviousPageParam: (firstPage) =>
      firstPage.previousCursor
        ? { cursor: firstPage.previousCursor, kind: "older" }
        : undefined,
    initialPageParam: NEWEST_PAGE,
    queryFn: ({ pageParam }) =>
      fetchMessages(conversationId, pageParam, HISTORY_PAGE_SIZE),
    queryKey: ["messages", conversationId] as const,
    // Live updates come from the SSE stream, which folds creates/deletes
    // straight into this cache. Mount/focus/reconnect refetches therefore add
    // nothing but races: overlapping responses can land out of order and
    // replace freshly folded pages with a stale snapshot, which is exactly
    // what made the transcript differ on every open. Keep a short freshness
    // window so genuine remounts reuse the cache, and let the guarded
    // reconnect catch-up handle real gaps.
    refetchOnMount: true,
    refetchOnReconnect: true,
    refetchOnWindowFocus: false,
    staleTime: 30 * 1000,
  });

  const allMessages = useMemo(
    () => (messagesQuery.data?.pages ?? []).flatMap((page) => page.messages),
    [messagesQuery.data]
  );

  // Resolve a replyToId to its parent without scanning the whole list for
  // every rendered bubble.
  const messagesById = useMemo(
    () => new Map(allMessages.map((message) => [message.id, message])),
    [allMessages]
  );
  // Bumped only when a PREVIOUS page is prepended. An appended message can
  // never introduce a reply parent (parents are older), so rows can skip
  // re-rendering on append but must re-render on prepend to resolve a parent
  // that just became available. See the row memo comparator. Monotonic (a
  // running max) so the viewer's history trim, which shrinks pages, does not
  // lower the value and force every visible row to re-render.
  const pageCount = messagesQuery.data?.pages.length ?? 0;
  const [historyVersion, setHistoryVersion] = useState(0);
  if (pageCount > historyVersion) {
    setHistoryVersion(pageCount);
  }

  // Transcript position by message id, used to center the viewer's decrypt
  // window on the active image.
  const messageIndexById = useMemo(() => {
    const map = new Map<string, number>();
    for (const [index, message] of allMessages.entries()) {
      map.set(message.id, index);
    }
    return map;
  }, [allMessages]);

  const peer = detail?.conversation.members.find(
    (member) => member.userId !== user?.id
  )?.user;
  const peerPresence = peer
    ? (onlineUsers.find((u) => u.id === peer.id)?.status ?? null)
    : null;

  const userId = user?.id;

  // Seed the peer watermarks from the conversation detail. Merged, never
  // lowered, so a detail refetch cannot retract a receipt the realtime stream
  // already advanced.
  useEffect(() => {
    if (!detail) {
      return;
    }
    const marks = peerWatermarks(detail.conversation.members, userId);
    setPeerMarks((current) => ({
      deliveredAt: advanceWatermark(current.deliveredAt, marks.deliveredAt),
      readAt: advanceWatermark(current.readAt, marks.readAt),
    }));
  }, [detail, userId]);

  // The newest peer message currently loaded. Advancing the delivery watermark
  // to it is enough to cover every older peer message, so we ack one id per
  // burst rather than a request per row.
  const lastPeerMessageId = useMemo(() => {
    for (let index = allMessages.length - 1; index >= 0; index -= 1) {
      const candidate = allMessages[index];
      if (candidate && candidate.senderId !== userId) {
        return candidate.id;
      }
    }
    return null;
  }, [allMessages, userId]);

  // Tell the server we received the newest peer message, so the sender can flip
  // its own bubble to Delivered. Debounced so a burst folds into one request,
  // and deduped per id so a re-render or catch-up refetch does not re-POST.
  useEffect(() => {
    if (!lastPeerMessageId || lastPeerMessageId === lastAckedIdRef.current) {
      return;
    }
    const ack = async () => {
      lastAckedIdRef.current = lastPeerMessageId;
      try {
        await ackMessageDelivered(conversationId, lastPeerMessageId);
      } catch {
        // Best-effort: clear the dedupe marker so a later message (or reconnect
        // catch-up) retries the ack.
        lastAckedIdRef.current = null;
      }
    };
    const timer = setTimeout(() => {
      void ack();
    }, 1500);
    return () => clearTimeout(timer);
  }, [conversationId, lastPeerMessageId]);

  const handleReply = useCallback(
    (message: MessageData) => {
      // Read at click time so the quote always reflects the latest payload.
      const payload = messageDecryptor.get(message.id);
      setEditTarget(null);
      setReplyTarget({
        content: replyPreview(payload),
        id: message.id,
        senderId: message.senderId,
        senderName:
          message.senderId === userId
            ? "You"
            : (message.sender?.displayName ?? peer?.displayName ?? "them"),
      });
    },
    [peer?.displayName, userId]
  );

  // Enter edit mode for one of my own messages, seeding the composer with its
  // current text. Replying and editing cannot both be active, so the reply bar
  // is cleared.
  const handleEdit = useCallback((message: MessageData) => {
    const payload = messageDecryptor.get(message.id);
    if (!payload || payload === "error" || payload === "pending") {
      return;
    }
    setReplyTarget(null);
    setEditTarget({
      content: payload.content ?? "",
      id: message.id,
      payloadType: payload.type,
    });
  }, []);

  // ---- options menu + selection --------------------------------------------

  const closeOptions = useCallback(() => setOptionsTarget(null), []);

  // Applies a new selection set. Dropping the last ticked message quits select
  // mode entirely, so the bulk bar never lingers over an empty selection.
  const commitSelection = useCallback((next: ReadonlySet<string>) => {
    setSelectedIds(next);
    if (next.size === 0) {
      setSelectionActive(false);
    }
  }, []);

  const toggleSelected = useCallback(
    (messageId: string) => {
      const next = new Set(selectedIds);
      if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }
      commitSelection(next);
    },
    [commitSelection, selectedIds]
  );

  const startSelectionWith = useCallback((messageId: string) => {
    setSelectionActive(true);
    setSelectedIds(new Set([messageId]));
  }, []);

  const clearSelection = useCallback(() => {
    setSelectionActive(false);
    setSelectedIds(new Set());
  }, []);

  const openOptionsFor = useCallback(
    (message: MessageData, row: HTMLElement) => {
      // Anchor the pane to the SIDE of the message, never the pointer, so it
      // always opens in the same place beside that message. Own (sender)
      // messages open theirs to the left of the bubble, received (receiver)
      // messages to the right, so both lean toward the middle of the thread.
      // The virtual row spans the full width, so the bubble element (not the
      // row) is the anchor.
      const bubble =
        row.querySelector<HTMLElement>("[data-message-bubble]") ?? row;
      const rect = bubble.getBoundingClientRect();
      const mine = message.senderId === userId;
      setOptionsTarget({
        messageId: message.id,
        preferEnd: mine,
        rect: {
          bottom: rect.bottom,
          left: rect.left,
          right: rect.right,
          top: rect.top,
        },
      });
    },
    [userId]
  );

  // Resolves the transcript row under an event target. Every row wrapper carries
  // `data-message-id`, so this is one closest() walk — no per-row listeners.
  const resolveMessageFromEvent = useCallback(
    (
      target: EventTarget | null
    ): { message: MessageData; row: HTMLElement } | null => {
      if (!(target instanceof Element)) {
        return null;
      }
      const row = target.closest<HTMLElement>("[data-message-id]");
      const id = row?.dataset.messageId;
      if (!row || !id) {
        return null;
      }
      const message = messagesById.get(id);
      return message ? { message, row } : null;
    },
    [messagesById]
  );

  const handleOptionsCopy = useCallback((message: MessageData) => {
    void copyToClipboard(messagePlainText(messageDecryptor.get(message.id)));
  }, []);

  // "Delete for me": hide one or more rows optimistically, restoring the exact
  // prior cache if the server rejects it. The hide is actor-scoped, so no other
  // client is affected and no realtime fold is needed. A large batch is chunked
  // to the route's per-request cap.
  const deleteForMe = useCallback(
    async (messageIds: string[]) => {
      if (messageIds.length === 0) {
        return;
      }
      const idSet = new Set(messageIds);
      const previous = queryClient.getQueryData<MessagesInfiniteData>([
        "messages",
        conversationId,
      ]);
      queryClient.setQueryData<MessagesInfiniteData>(
        ["messages", conversationId] as const,
        (old) => {
          if (!old) {
            return old;
          }
          const nextPages = removeMessagesFromPages(old.pages, idSet);
          return nextPages ? { ...old, pages: nextPages } : old;
        }
      );
      try {
        // The route caps one request at MAX_HIDE_BATCH, so a large selection is
        // sent in chunks rather than as one oversized batch it would refuse.
        await Promise.all(
          chunkMessageIds(messageIds).map((chunk) =>
            hideMessages(conversationId, chunk)
          )
        );
      } catch (error) {
        // Restore the pre-delete cache rather than refetching, which would race
        // the optimistic state. Any message the SSE stream folded in during the
        // request is restored by the stream's own refold on the next event.
        if (previous) {
          queryClient.setQueryData(["messages", conversationId], previous);
        }
        toast({
          description:
            error instanceof Error ? error.message : "Couldn't hide messages",
          title: "Delete for me failed",
          variant: "destructive",
        });
        return;
      }
      // A hidden message is gone from this device's transcript, so it must also
      // leave the local search index: otherwise the index would still surface
      // text the user can no longer see.
      searchWriterRef.current?.remove(messageIds);
      // Only drop the hidden rows from the selection once the hide succeeded,
      // so a failed batch keeps the user's selection for a retry (ending select
      // mode when the last ticked row goes).
      if ([...idSet].some((id) => selectedIds.has(id))) {
        const next = new Set(selectedIds);
        for (const id of idSet) {
          next.delete(id);
        }
        commitSelection(next);
      }
    },
    [commitSelection, conversationId, queryClient, selectedIds]
  );

  // "Delete for everyone": globally mark the row deleted (sender-only on the
  // server), optimistically, and restore on failure.
  const deleteForEveryone = useCallback(
    async (message: MessageData) => {
      const previous = queryClient.getQueryData<MessagesInfiniteData>([
        "messages",
        conversationId,
      ]);
      queryClient.setQueryData<MessagesInfiniteData>(
        ["messages", conversationId] as const,
        (old) => {
          if (!old) {
            return old;
          }
          const nextPages = markMessagesDeletedInPages(
            old.pages,
            new Set([message.id]),
            new Date()
          );
          return nextPages ? { ...old, pages: nextPages } : old;
        }
      );
      try {
        await deleteMessage(message.id);
      } catch (error) {
        if (previous) {
          queryClient.setQueryData(["messages", conversationId], previous);
        }
        toast({
          description:
            error instanceof Error ? error.message : "Couldn't delete message",
          title: "Delete failed",
          variant: "destructive",
        });
      }
    },
    [conversationId, queryClient]
  );

  // Opens the confirmation for a single "delete for me", closing the options
  // pane first so the two surfaces are never open together.
  const requestDeleteForMe = useCallback(
    (message: MessageData) => {
      closeOptions();
      setPendingDelete({ messageIds: [message.id], scope: "for-me" });
      setDeleteOpen(true);
    },
    [closeOptions]
  );

  // Opens the confirmation for the current multi-select batch, capturing the
  // ticked ids at request time.
  const requestDeleteSelectedForMe = useCallback(() => {
    if (selectedIds.size === 0) {
      return;
    }
    closeOptions();
    setPendingDelete({ messageIds: [...selectedIds], scope: "for-me" });
    setDeleteOpen(true);
  }, [closeOptions, selectedIds]);

  const requestDeleteForEveryone = useCallback(
    (message: MessageData) => {
      closeOptions();
      setPendingDelete({ message, scope: "for-everyone" });
      setDeleteOpen(true);
    },
    [closeOptions]
  );

  // Runs the confirmed delete and dismisses the dialog. The handlers surface
  // their own failures as toasts, so this only owns the busy/dismiss lifecycle.
  // `pendingDelete` is intentionally not cleared: the dialog stays mounted with
  // its last content through the close transition so focus restores.
  const confirmPendingDelete = useCallback(async () => {
    const pending = pendingDelete;
    if (!pending || deleteBusy) {
      return;
    }
    setDeleteBusy(true);
    try {
      await (pending.scope === "for-everyone"
        ? deleteForEveryone(pending.message)
        : deleteForMe(pending.messageIds));
    } catch {
      // Handlers report their own failures; nothing to add here.
    }
    setDeleteBusy(false);
    setDeleteOpen(false);
  }, [deleteBusy, deleteForEveryone, deleteForMe, pendingDelete]);

  // Enter select mode from the options menu, ticking the target message.
  const handleOptionsSelect = useCallback(
    (message: MessageData) => startSelectionWith(message.id),
    [startSelectionWith]
  );

  // ---- transcript gesture handlers (delegated at the container) ------------

  // Desktop: a plain left click does nothing (so text selection works). It only
  // toggles a row while select mode is active, or opens the pane from the
  // dedicated trigger button. Touch: a tap opens the pane for that message.
  const handleTranscriptClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      // A click that ends a drag-select is not a click on a message.
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return;
      }
      const hit = resolveMessageFromEvent(event.target);
      if (!hit) {
        return;
      }
      const onOptionsTrigger =
        event.target instanceof Element &&
        event.target.closest("[data-open-options]") !== null;
      if (onOptionsTrigger) {
        openOptionsFor(hit.message, hit.row);
        return;
      }
      // Never hijack a click meant for a link, button, embed, or media viewer.
      if (isInteractiveTarget(event.target)) {
        return;
      }
      if (selectionActive) {
        toggleSelected(hit.message.id);
        return;
      }
      // Touch has exactly one message gesture: tap to open the options pane.
      if (!finePointerRef.current) {
        openOptionsFor(hit.message, hit.row);
      }
    },
    [openOptionsFor, resolveMessageFromEvent, selectionActive, toggleSelected]
  );

  // Desktop only: double click replies.
  const handleTranscriptDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!finePointerRef.current || selectionActive) {
        return;
      }
      const hit = resolveMessageFromEvent(event.target);
      if (!hit || isInteractiveTarget(event.target)) {
        return;
      }
      event.preventDefault();
      handleReply(hit.message);
    },
    [handleReply, resolveMessageFromEvent, selectionActive]
  );

  // Desktop only: right click opens the pane beside the message and suppresses
  // the browser's own menu. This is the sole pointer trigger for the pane.
  const handleTranscriptContextMenu = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!finePointerRef.current || selectionActive) {
        return;
      }
      const hit = resolveMessageFromEvent(event.target);
      if (!hit) {
        // Not on a message: leave the browser's own menu alone.
        return;
      }
      event.preventDefault();
      openOptionsFor(hit.message, hit.row);
    },
    [openOptionsFor, resolveMessageFromEvent, selectionActive]
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      // Track the press so a subsequent move can tell a tap from a scroll/drag.
      // Only the primary button and message rows count.
      if (event.button !== 0) {
        return;
      }
      const hit = resolveMessageFromEvent(event.target);
      if (!hit || isInteractiveTarget(event.target)) {
        return;
      }
      const index = messageIndexById.get(hit.message.id);
      if (index === undefined) {
        return;
      }
      const touch = event.pointerType === "touch";
      pointerRef.current = {
        base: selectedIds,
        index,
        messageId: hit.message.id,
        mode: dragSelectionMode(selectedIds, hit.message.id),
        startX: event.clientX,
        startY: event.clientY,
        touch,
      };
      suppressClickRef.current = false;
    },
    [messageIndexById, resolveMessageFromEvent, selectedIds]
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const pointer = pointerRef.current;
      if (!pointer) {
        return;
      }
      if (
        !exceededSlop(
          { x: pointer.startX, y: pointer.startY },
          { x: event.clientX, y: event.clientY }
        )
      ) {
        return;
      }
      // Past the slop this is a drag (or a touch scroll), never a click.
      suppressClickRef.current = true;
      if (pointer.touch) {
        // Touch has no drag-select: let the browser scroll freely.
        pointerRef.current = null;
        return;
      }
      if (event.buttons !== 1) {
        pointerRef.current = null;
        return;
      }
      const element = document.elementFromPoint(event.clientX, event.clientY);
      const row =
        element instanceof Element
          ? element.closest<HTMLElement>("[data-message-id]")
          : null;
      const rawIndex = row?.dataset.index;
      const currentIndex =
        rawIndex === undefined ? pointer.index : Number(rawIndex);
      if (Number.isNaN(currentIndex)) {
        return;
      }
      // A drag is an explicit selection gesture: keep select mode on while it
      // is under way (even if the range momentarily clears every tick), so
      // continuing the drag does not fight an exit. A discrete click that drops
      // the last tick does exit, in commitSelection.
      if (!selectionActive) {
        setSelectionActive(true);
      }
      const ids = selectionRange(pointer.index, currentIndex)
        .map((index) => allMessages[index]?.id)
        .filter((id): id is string => typeof id === "string");
      // Rebuild from the drag-start snapshot: adding selects the range, and a
      // drag that began on a selected row clears it.
      setSelectedIds(applySelectionRange(pointer.base, ids, pointer.mode));
    },
    [allMessages, selectionActive]
  );

  const handlePointerEnd = useCallback(() => {
    pointerRef.current = null;
  }, []);

  // Escape clears select mode; the options menu handles its own Escape.
  useEffect(() => {
    if (!selectionActive) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        clearSelection();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [clearSelection, selectionActive]);

  // Rewrites the message being edited: re-encrypt under its original epoch,
  // PATCH the row, fold the updated row into the cache, and evict the stale
  // plaintext so the bubble re-decrypts. The composer owns the text state and
  // calls this with the trimmed body.
  const handleEditSave = useCallback(
    async (content: string): Promise<boolean> => {
      if (!user || !privateKey || !editTarget || !detail) {
        return false;
      }
      // A text message must keep a body; a media/post caption may be cleared.
      if (editTarget.payloadType === "text" && content.length === 0) {
        return false;
      }
      const message = messagesById.get(editTarget.id);
      const payload = messageDecryptor.get(editTarget.id);
      if (
        !message ||
        !payload ||
        payload === "error" ||
        payload === "pending"
      ) {
        toast({
          description: "This message isn't ready to edit yet",
          title: "Can't edit",
          variant: "destructive",
        });
        return false;
      }
      try {
        const wrappedKeys = findMyWrappedKeys(detail.keys, user.id);
        const peerPublicKey = findPeerPublicKey(detail.conversation, user.id);
        if (!rootKeyStore || wrappedKeys.length === 0 || !peerPublicKey) {
          toast({
            description: "Message keys aren't ready yet",
            title: "Can't edit",
            variant: "destructive",
          });
          return false;
        }
        // Reuse the thread's cached root store: it already resolved this
        // conversation's epochs for decrypting, so an edit pays no extra ECDH.
        // It rejects when nothing unwraps, which the catch below reports.
        let rootKeys: Uint8Array[] = [];
        try {
          rootKeys = await rootKeyStore.getRootKeys(
            conversationId,
            wrappedKeys,
            peerPublicKey
          );
        } catch {
          rootKeys = [];
        }
        const encrypted = await reencryptMessageForEdit({
          conversationId,
          current: {
            ciphertext: message.ciphertext,
            iv: message.iv,
            ratchetIndex: message.ratchetIndex,
          },
          editedPayload: editMessagePayload(payload, content),
          rootKeys,
          senderId: user.id,
        });
        if (!encrypted) {
          toast({
            description: "Couldn't re-encrypt this message",
            title: "Can't edit",
            variant: "destructive",
          });
          return false;
        }
        const updated = await editMessage(editTarget.id, encrypted);
        // Patch the row in place and drop the stale plaintext so the row
        // re-decrypts to the new text. The SSE echo of our own edit is deduped
        // by id, so this fold and the echo converge on the same row.
        queryClient.setQueryData<MessagesInfiniteData>(
          ["messages", conversationId] as const,
          (old) => {
            if (!old) {
              return old;
            }
            const nextPages = updateMessageInPages(old.pages, updated);
            return nextPages ? { ...old, pages: nextPages } : old;
          }
        );
        messageDecryptor.invalidate(editTarget.id);
        setEditTarget(null);
        return true;
      } catch (error) {
        toast({
          description:
            error instanceof Error ? error.message : "Couldn't edit message",
          title: "Edit failed",
          variant: "destructive",
        });
        return false;
      }
    },
    [
      conversationId,
      detail,
      editTarget,
      messagesById,
      privateKey,
      queryClient,
      rootKeyStore,
      user,
    ]
  );

  // The decryptor cache is scoped to this identity so a logout/login never
  // serves another account's plaintext.
  useEffect(() => {
    messageDecryptor.configureScope(userId ?? "anonymous");
  }, [userId]);

  // Turns one wire message into a decrypt request item. Stable helper so the
  // request effect and row-level parent fetches share the exact shape.
  const toDecryptItem = useCallback(
    (message: MessageData): DecryptItem => ({
      conversationId,
      message: {
        ciphertext: message.ciphertext,
        id: message.id,
        iv: message.iv,
        ratchetIndex: message.ratchetIndex,
        senderId: message.senderId,
      },
    }),
    [conversationId]
  );

  // Resolves (via the decryptor's per-conversation cache) the imported ratchet
  // base keys every queued message in this thread funnels through: one per
  // root-key epoch this device can still unwrap, newest first, so a message
  // sent before an identity rotation stays readable.
  const getBaseKeys = useCallback(
    async (targetConversationId: string): Promise<CryptoKey[]> => {
      if (
        !detail ||
        !rootKeyStore ||
        !userId ||
        targetConversationId !== conversationId
      ) {
        return [];
      }
      const wrappedKeys = findMyWrappedKeys(detail.keys, userId);
      const peerPublicKey = findPeerPublicKey(detail.conversation, userId);
      if (wrappedKeys.length === 0 || !peerPublicKey) {
        return [];
      }
      try {
        const rootKeys = await rootKeyStore.getRootKeys(
          conversationId,
          wrappedKeys,
          peerPublicKey
        );
        return await Promise.all(rootKeys.map(importRatchetBaseKey));
      } catch {
        return [];
      }
    },
    [conversationId, detail, rootKeyStore, userId]
  );

  // oxlint-disable-next-line react/incompatible-library -- useVirtualizer returns unmemoizable measuring/scroll handles by design (upstream chat recipe); rows stay memoized on their own props
  const rowVirtualizer = useVirtualizer({
    anchorTo: "end",
    count: allMessages.length,
    estimateSize: () => ESTIMATED_ROW_SIZE,
    followOnAppend: true,
    // Must track `allMessages`, not a ref. The virtualizer calls setOptions
    // during render (before layout effects sync a ref), so a stale getItemKey
    // would resolve the wrong key for every index on a prepend and break the
    // end-anchor math — the viewport teleports instead of holding position.
    getItemKey: useCallback(
      (index: number) => allMessages[index]?.id ?? `index-${index}`,
      [allMessages]
    ),
    getScrollElement: () => scrollRef.current,
    overscan: ROW_OVERSCAN,
    paddingEnd: 8,
    paddingStart: 16,
    // Same threshold the pinned tracker uses, so "follow new messages" and
    // "show the jump badge" flip at exactly the same scroll position.
    scrollEndThreshold: PINNED_THRESHOLD_PX,
    // Keep the library default. When a row above the fold re-measures (decrypt
    // or image load), the virtualizer writes `scrollTop` in the ResizeObserver
    // callback; the matching transform commit has to land in the same frame or
    // the browser paints one frame at the new offset with the old positions and
    // the viewport visibly jumps. Only fires on range/isScrolling changes, not
    // per scroll frame.
    useFlushSync: true,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();
  const virtualRangeKey = (() => {
    const lastItem = virtualItems.at(-1);
    return virtualItems.length > 0 && lastItem
      ? `${virtualItems[0].index}:${lastItem.index}`
      : "empty";
  })();
  // True while a fling/scroll is in progress. Pending rows drop their pulse
  // animation while it is true (a compositor animation on every mounted
  // skeleton is pure cost mid-scroll); decrypt requests are NOT gated on it, so
  // prefetch keeps up with the fling instead of stalling until it settles.
  const scrolling = rowVirtualizer.isScrolling;

  // Queue decrypts for the visible window plus a prefetch margin, visible
  // rows first. History outside the window is never requested until scrolled
  // near, and deleted rows need no payload at all. Reply parents are fetched
  // by the row that quotes them (see VirtualRow), so this effect does not
  // depend on decrypt results and never re-runs on a completion batch.
  //
  // Deliberately synchronous: a requestAnimationFrame deferral here was tried
  // and reverted. During a fling the range key changes every few frames, so the
  // effect's cleanup kept cancelling the pending frame and prefetch stalled
  // until the scroll settled — rows then arrived still encrypted and popped in.
  useEffect(() => {
    if (!detail || !rootKeyStore || !userId || allMessages.length === 0) {
      return;
    }
    const [first, last] = (() => {
      const items = rowVirtualizer.getVirtualItems();
      const lastItem = items.at(-1);
      if (items.length === 0 || !lastItem) {
        return [allMessages.length - 1, allMessages.length - 1] as const;
      }
      return [items[0].index, lastItem.index] as const;
    })();
    const start = Math.max(0, first - DECRYPT_PREFETCH_ROWS);
    const end = Math.min(allMessages.length - 1, last + DECRYPT_PREFETCH_ROWS);
    const items: DecryptItem[] = [];
    const seen = new Set<string>();
    const push = (message: MessageData | undefined) => {
      if (!message || message.deletedAt || seen.has(message.id)) {
        return;
      }
      seen.add(message.id);
      items.push(toDecryptItem(message));
    };
    for (let index = first; index <= last; index += 1) {
      push(allMessages[index]);
    }
    for (let index = first - 1; index >= start; index -= 1) {
      push(allMessages[index]);
    }
    for (let index = last + 1; index <= end; index += 1) {
      push(allMessages[index]);
    }
    messageDecryptor.request(items, { getBaseKeys });
    // virtualRangeKey re-runs this on scroll; request() itself is a cheap skip
    // for cached, queued, and in-flight ids.
  }, [
    allMessages,
    conversationId,
    detail,
    getBaseKeys,
    rootKeyStore,
    toDecryptItem,
    userId,
    virtualRangeKey,
    rowVirtualizer,
  ]);

  // Row-level request helper: a row asks for its own payload (self-heal) or a
  // quoted parent's. request() is idempotent and cheap for cached/queued/
  // in-flight ids, so over-calling is harmless.
  const requestDecrypt = useCallback(
    (message: MessageData | undefined) => {
      // Hold the request until the thread's prerequisites exist. Queueing
      // before then makes getBaseKeys resolve empty, which the decryptor records
      // as a terminal "error" and the row briefly renders a Retry button
      // instead of its loading skeleton (the key-healing effect clears it, so
      // this is only a transient flicker). The request effect re-runs once
      // these dependencies arrive, so nothing is lost by returning early.
      if (!message || !detail || !rootKeyStore || !userId) {
        return;
      }
      messageDecryptor.request([toDecryptItem(message)], { getBaseKeys });
    },
    [detail, getBaseKeys, rootKeyStore, toDecryptItem, userId]
  );

  // Open the conversation-wide viewer at a tile's image. Stable identity so the
  // provider value never changes and media tiles never re-render from it.
  const openConversationMedia = useCallback<OpenConversationMedia>(
    ({ imageIndex, messageId }) => {
      setMediaViewerKey(mediaFlatKey(messageId, imageIndex));
    },
    []
  );

  // Decrypt a window of transcript around the viewer's active image so adjacent
  // media is discovered. Shared by the viewer's centered window (via
  // requestViewerWindow) and by the older-page loader. Ids already proven
  // non-media are skipped so a text-heavy stretch is never re-derived.
  const requestDecryptRange = useCallback(
    (start: number, end: number) => {
      if (!detail || !rootKeyStore || !userId) {
        return;
      }
      const from = Math.max(0, start);
      const to = Math.min(allMessages.length - 1, end);
      const items: DecryptItem[] = [];
      for (let index = from; index <= to; index += 1) {
        const message = allMessages[index];
        if (message && !message.deletedAt && !viewerScanCache.has(message.id)) {
          items.push(toDecryptItem(message));
          pendingScanRef.current.add(message.id);
        }
      }
      if (items.length > 0) {
        messageDecryptor.request(items, { getBaseKeys });
      }
    },
    [
      allMessages,
      detail,
      getBaseKeys,
      rootKeyStore,
      toDecryptItem,
      userId,
      viewerScanCache,
    ]
  );

  // Decrypt an explicit list of messages (already-resolved objects, so callers
  // are not tied to `allMessages` indices). Used for freshly prepended pages.
  const requestDecryptMessages = useCallback(
    (messages: MessageData[]) => {
      if (!detail || !rootKeyStore || !userId) {
        return;
      }
      const items: DecryptItem[] = [];
      for (const message of messages) {
        if (!message.deletedAt && !viewerScanCache.has(message.id)) {
          items.push(toDecryptItem(message));
          pendingScanRef.current.add(message.id);
        }
      }
      if (items.length > 0) {
        messageDecryptor.request(items, { getBaseKeys });
      }
    },
    [detail, getBaseKeys, rootKeyStore, toDecryptItem, userId, viewerScanCache]
  );

  // Center the viewer's decrypt window on its active image; `extend` widens it
  // in the travel direction when the user hits the end of known media.
  const requestViewerWindow = useCallback(
    (messageId: string, extend: MediaNavDirection) => {
      const base = messageIndexById.get(messageId);
      if (base === undefined) {
        return;
      }
      let start = base - VIEWER_DECRYPT_RADIUS;
      let end = base + VIEWER_DECRYPT_RADIUS;
      if (extend === "older") {
        start = base - VIEWER_DECRYPT_RADIUS * 2;
      } else if (extend === "newer") {
        end = base + VIEWER_DECRYPT_RADIUS * 2;
      }
      requestDecryptRange(start, end);
    },
    [messageIndexById, requestDecryptRange]
  );

  const handleViewerActive = useCallback(
    (flatKey: string, direction: MediaNavDirection) => {
      // Moving newer ends an older-history walk, which re-enables the history
      // trim; moving older or staying put keeps it suppressed.
      if (direction === "newer") {
        olderWalkRef.current = false;
      }
      requestViewerWindow(messageIdFromFlatKey(flatKey), direction);
    },
    [requestViewerWindow]
  );

  // A signature of everything decryption depends on: my wraps for this
  // conversation (ciphertext per epoch) and the peer's public key. When it
  // changes, the cached roots are invalid and every failed payload is worth
  // retrying. Used both to clear the decryptor's caches and to gate the
  // stale-snapshot refetch below so a failure cannot loop forever.
  const keySignature = useMemo(() => {
    if (!detail || !userId) {
      return "";
    }
    const wraps = findMyWrappedKeys(detail.keys, userId)
      .map((key) => `${key.version}:${key.encryptedKey.ciphertext}`)
      .join("|");
    return `${wraps}#${findPeerPublicKey(detail.conversation, userId) ?? ""}`;
  }, [detail, userId]);

  // Healed keys (re-provisioned identity, first wrapped-key post, peer reset)
  // must retry payloads that previously failed. Dropping the errors makes both
  // the request effect and each row's self-heal re-queue them. The viewer scan
  // cache is dropped too: under new keys a previously non-media resolution is
  // no longer trustworthy. Gated on `keySignature`, not `detail` identity, so a
  // refetch that returns the same keys (e.g. a read-receipt-driven invalidate)
  // does not needlessly clear errors and re-decrypt the visible window.
  useEffect(() => {
    if (!keySignature || !rootKeyStore || !userId) {
      return;
    }
    messageDecryptor.clearErrors();
    // The key store's identity changes on an unlock or an identity reset, so
    // drop the decryptor's cached per-conversation roots too. Without this a
    // reset would keep decrypting with the superseded identity's epochs.
    messageDecryptor.clearKeys();
    viewerScanCache.clear();
    pendingScanRef.current.clear();
  }, [keySignature, rootKeyStore, userId, viewerScanCache]);

  // Last key signature for which a decrypt failure already triggered a refetch.
  // A payload that is genuinely undecryptable (an old epoch whose wrap is gone,
  // or corrupt ciphertext) stays "error" forever, so refetching on every
  // failure would spin. One refetch per signature is enough: if the keys really
  // did change, the refetch lands a new signature and re-arms this; if they did
  // not, the payload is permanently unreadable and there is nothing to fetch.
  const refetchedForSignatureRef = useRef<string | null>(null);

  // Self-heal a stale key snapshot from the read side. A failed decrypt is the
  // only signal that our cached wraps or the peer's public key may be out of
  // date (their reset published `keys.rotated`, but that event can be missed on
  // a reconnect gap or a raced query). When a failure appears under a signature
  // we have not already refetched for, invalidate the detail; the resulting
  // signature change clears errors and re-queues the payloads.
  useEffect(() => {
    if (!detail || !rootKeyStore || !userId || keySignature === "") {
      return;
    }
    const heal = () => {
      if (messageDecryptor.getErroredIds(conversationId).size === 0) {
        return;
      }
      if (refetchedForSignatureRef.current === keySignature) {
        return;
      }
      refetchedForSignatureRef.current = keySignature;
      void queryClient.invalidateQueries({
        queryKey: ["message-conversation", conversationId],
      });
    };
    const unsubscribe = messageDecryptor.subscribe(heal);
    // A failure may already be present when this effect (re)mounts.
    heal();
    return unsubscribe;
  }, [conversationId, detail, keySignature, queryClient, rootKeyStore, userId]);

  // Classify viewer discovery results into the scan cache without re-rendering:
  // a plain decryptor subscription (not useSyncExternalStore) runs on every
  // version bump, records ids that resolved to non-media, and drops ids that
  // resolved to media or errored. The pending set is only the viewer's recent
  // window, so this stays O(window) and empties itself as results land.
  useEffect(() => {
    const classify = () => {
      if (pendingScanRef.current.size === 0) {
        return;
      }
      for (const id of pendingScanRef.current) {
        const entry = messageDecryptor.get(id);
        if (entry === undefined || entry === "pending") {
          continue;
        }
        pendingScanRef.current.delete(id);
        if (entry !== "error" && entry.type !== "media") {
          viewerScanCache.mark(id);
        }
      }
    };
    const unsubscribe = messageDecryptor.subscribe(classify);
    classify();
    return unsubscribe;
  }, [viewerScanCache]);

  // Start pinned to the latest message. The scroll element only exists once
  // `detail` resolves (before that the skeleton renders), so this must key on
  // detail and run exactly once — not on every detail refetch.
  const didInitialScrollRef = useRef(false);
  useLayoutEffect(() => {
    if (!detail || didInitialScrollRef.current) {
      return;
    }
    didInitialScrollRef.current = true;
    rowVirtualizer.scrollToEnd();
  }, [detail, rowVirtualizer]);

  // The landing above runs the moment `detail` resolves, when the first page
  // of messages is usually still in flight — so it scrolls an empty list and
  // the transcript then renders from the top. Re-pin once the first real
  // content exists so opening or refreshing a thread always shows the newest
  // message, regardless of which query settled first. The extra rAF re-pins
  // after the first measurement pass corrects the estimated row heights,
  // which otherwise leaves the view a little short of the true end.
  const hasLandedRef = useRef(false);
  useLayoutEffect(() => {
    if (hasLandedRef.current || allMessages.length === 0 || !detail) {
      return;
    }
    hasLandedRef.current = true;
    rowVirtualizer.scrollToEnd();
    const frame = requestAnimationFrame(() => {
      rowVirtualizer.scrollToEnd();
    });
    return () => cancelAnimationFrame(frame);
  }, [allMessages.length, detail, rowVirtualizer]);

  // Track the pinned state from actual scroll position. Passive listener with
  // change-gated state writes, so scrolling never triggers a render storm.
  // Becoming pinned clears the arrival badge (the user has caught up).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    const measure = () => {
      const pinned = isNearBottom(el);
      if (pinned === pinnedRef.current) {
        return;
      }
      pinnedRef.current = pinned;
      setPinnedToBottom(pinned);
      if (pinned) {
        setArrivalCount(0);
      }
    };
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    return () => el.removeEventListener("scroll", measure);
  }, [detail]);

  // When the peer starts typing, reveal the in-flow typing row if the viewport
  // is pinned to the bottom. The row lives after the virtualized list (not as
  // an overlay), so the scroll height grows — pin to the new bottom so the
  // bubble is visible instead of covering the last message. Gated on pinned:
  // a user reading history is never yanked.
  useEffect(() => {
    if (!peerTyping || !pinnedRef.current) {
      return;
    }
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      el.scrollTo({ top: el.scrollHeight });
    });
    return () => cancelAnimationFrame(frame);
  }, [peerTyping]);

  // Pull older history as the top of the loaded window nears the first
  // virtual row. Stable keys keep the viewport anchored on prepend.
  const {
    fetchNextPage,
    fetchPreviousPage,
    hasNextPage,
    hasPreviousPage,
    isFetchingNextPage,
    isFetchingPreviousPage,
  } = messagesQuery;
  useEffect(() => {
    // While the fullscreen viewer is open the transcript is frozen behind it,
    // and the viewer drives history loads itself. Letting the transcript's
    // near-top auto-loader fire here would race the viewer's window trim
    // (prepend, then immediately drop the same pages).
    if (mediaViewerKey) {
      return;
    }
    if (
      virtualItems.length > 0 &&
      virtualItems[0].index < 4 &&
      hasPreviousPage &&
      !isFetchingPreviousPage
    ) {
      void fetchPreviousPage();
    }
  }, [
    fetchPreviousPage,
    hasPreviousPage,
    isFetchingPreviousPage,
    mediaViewerKey,
    virtualItems,
  ]);

  // Grow toward the present as the user scrolls off the top of an anchored
  // window. Only a window opened mid-history has a next page, so this is inert
  // in the normal tail-loaded case. Fetching a newer page prepends rows above
  // the viewport, which the virtualizer's own scroll compensation absorbs.
  useEffect(() => {
    if (mediaViewerKey || !hasNextPage || isFetchingNextPage) {
      return;
    }
    if (virtualItems.length > 0 && virtualItems[0].index < 4) {
      void fetchNextPage();
    }
  }, [
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    mediaViewerKey,
    virtualItems,
  ]);

  const retryDecrypt = useCallback(
    (message: MessageData) => {
      if (!detail || !rootKeyStore || !userId) {
        return;
      }
      // A retry may resolve differently, so forget any prior scan verdict.
      viewerScanCache.delete(message.id);
      pendingScanRef.current.delete(message.id);
      messageDecryptor.retry(message.id);
      requestDecrypt(message);
    },
    [detail, requestDecrypt, rootKeyStore, userId, viewerScanCache]
  );

  // Batch decrypt request for rows outside the visible window (in-conversation
  // search indexing). Unlike the viewer's loader there is no scan-cache
  // filter: every undecrypted row is eligible, and request() itself dedupes
  // cached, queued, and in-flight ids.
  const requestDecryptBatch = useCallback(
    (messages: MessageData[]) => {
      if (!detail || !rootKeyStore || !userId) {
        return;
      }
      const items = messages.flatMap((message) =>
        message.deletedAt ? [] : [toDecryptItem(message)]
      );
      if (items.length > 0) {
        messageDecryptor.request(items, { getBaseKeys });
      }
    },
    [detail, getBaseKeys, rootKeyStore, toDecryptItem, userId]
  );

  // Serialized older-page loader shared by in-conversation search (which walks
  // the whole thread through the same infinite-query cache the transcript
  // renders from) and the media viewer's on-demand loader below. Resolves with
  // the newly prepended messages, diffed by id because the viewer history
  // window may trim oldest pages concurrently.
  const loadOlderMessages = useCallback(async (): Promise<MessageData[]> => {
    // Only `loadingOlderRef` gates concurrency. Dropping the `isFetching`
    // check keeps an awaited walk going between fetches: query state flips
    // asynchronously, so a render-scoped closure would report "busy" as "no
    // more history" and stop after a single page.
    if (loadingOlderRef.current || !hasPreviousPage) {
      return [];
    }
    loadingOlderRef.current = true;
    const known = new Set(allMessages.map((message) => message.id));
    let result: Awaited<ReturnType<typeof fetchPreviousPage>> | null = null;
    try {
      result = await fetchPreviousPage();
    } catch {
      loadingOlderRef.current = false;
      return [];
    }
    loadingOlderRef.current = false;
    const nextMessages = (result.data?.pages ?? []).flatMap(
      (page) => page.messages
    );
    return nextMessages.filter((message) => !known.has(message.id));
  }, [allMessages, fetchPreviousPage, hasPreviousPage]);

  // Jump to a search result: center the row and flash its bubble. When the row
  // is not in the loaded window, one anchored read replaces the window with a
  // page centered on the target — O(limit) regardless of how deep in history it
  // sits, instead of walking every page from the newest message. The bounded
  // older-page walk stays as a fallback for a target that has since been
  // deleted or hidden, which an anchored read cannot land on.
  const jumpToMessage = useCallback(
    async (messageId: string) => {
      const readFlat = () => {
        const data = queryClient.getQueryData<MessagesInfiniteData>([
          "messages",
          conversationId,
        ]);
        return (data?.pages ?? []).flatMap((page) => page.messages);
      };
      let index = readFlat().findIndex((message) => message.id === messageId);
      if (index === -1) {
        try {
          const window = await fetchMessages(
            conversationId,
            { kind: "around", messageId },
            HISTORY_PAGE_SIZE
          );
          requestDecryptBatch(window.messages);
          if (window.messages.length > 0) {
            // The anchored read becomes the whole loaded window. pageParams[0]
            // is the sentinel for "this is a window, not the newest page", and
            // both cursors on the page drive the auto-loaders from here.
            queryClient.setQueryData<MessagesInfiniteData>(
              ["messages", conversationId],
              { pageParams: [NEWEST_PAGE], pages: [window] }
            );
            index = readFlat().findIndex((m) => m.id === messageId);
          }
        } catch {
          // Fall through to the bounded walk below: a failed anchor read must
          // not make the jump a dead end when the target is reachable by paging.
        }
      }
      // oxlint-disable no-await-in-loop -- bounded older-history walk with early exit
      for (let walks = 0; walks < 30 && index === -1; walks += 1) {
        const data = queryClient.getQueryData<MessagesInfiniteData>([
          "messages",
          conversationId,
        ]);
        if (!data?.pages[0]?.previousCursor) {
          break;
        }
        const added = await loadOlderMessages();
        if (added.length === 0) {
          break;
        }
        requestDecryptBatch(added);
        index = readFlat().findIndex((message) => message.id === messageId);
      }
      // oxlint-enable no-await-in-loop
      if (index === -1) {
        return;
      }
      if (jumpTimerRef.current) {
        clearTimeout(jumpTimerRef.current);
      }
      setSearchActiveId(messageId);
      setJumpTargetId(messageId);
      jumpTimerRef.current = setTimeout(() => {
        setJumpTargetId(null);
      }, 850);
      rowVirtualizer.scrollToIndex(index, {
        align: "center",
        behavior: "auto",
      });
      // Re-anchor on the next frame: the target row may still be at its
      // estimated height (pending decrypt), and the first landing uses that
      // estimate. Same pattern as the viewer's close-and-land.
      requestAnimationFrame(() => {
        rowVirtualizer.scrollToIndex(index, {
          align: "center",
          behavior: "auto",
        });
      });
    },
    [
      conversationId,
      loadOlderMessages,
      queryClient,
      requestDecryptBatch,
      rowVirtualizer,
    ]
  );

  // Resolve the index backend once per conversation. A failure here is not
  // fatal: `resolveSearchIndexStore` already falls back to an in-memory store,
  // and the caller treats null as "no index, loaded rows only".
  useEffect(() => {
    let cancelled = false;
    const resolve = async () => {
      try {
        const resolved = await resolveSearchIndexStore();
        if (!cancelled) {
          setSearchIndex({ refreshToken: 0, store: resolved.store });
        }
      } catch {
        // Both backends unavailable. Search still works over loaded rows.
        if (!cancelled) {
          setSearchIndex(null);
        }
      }
    };
    void resolve();
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  // The index writer for this conversation. Created once the store resolves and
  // torn down on conversation change so one thread never writes another
  // conversation's entries.
  // Destructured out of the state object so effect dependencies reference the
  // values themselves, which is what makes them valid dependencies.
  const searchIndexStore = searchIndex?.store ?? null;
  const searchIndexToken = searchIndex?.refreshToken ?? 0;
  const searchWriterRef = useRef<ReturnType<
    typeof createMessageIndexWriter
  > | null>(null);

  // Bumping the token re-reads the posting lists and the row table, so newly
  // indexed history is findable without waiting for the next search session.
  // During a backfill that read is expensive, so writes are coalesced instead.
  const backfillRunningRef = useRef(false);
  const coverageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bumpSearchIndex = useCallback(() => {
    setSearchIndex((current) =>
      current ? { ...current, refreshToken: current.refreshToken + 1 } : current
    );
  }, []);
  const scheduleCoverageRefresh = useCallback(() => {
    if (coverageTimerRef.current) {
      return;
    }
    coverageTimerRef.current = setTimeout(() => {
      coverageTimerRef.current = null;
      bumpSearchIndex();
    }, COVERAGE_REFRESH_DEBOUNCE_MS);
  }, [bumpSearchIndex]);

  // Keep the index inside its budget. Runs once per conversation open, which is
  // cheap: the policy reads one small meta record per conversation and the row
  // allocator, never the posting lists.
  const enforceIndexBudget = useCallback(async () => {
    if (!searchIndexStore) {
      return 0;
    }
    try {
      const summaries = await searchIndexStore.listConversations();
      const plan = planSearchIndexEviction({
        activeConversationId: conversationId,
        summaries,
      });
      // oxlint-disable no-await-in-loop -- one clear per victim, deliberately serial
      for (const victim of plan.evict) {
        await searchIndexStore.clearConversation(victim);
      }
      return plan.evict.length;
    } catch {
      // Enumeration failed: storage is in a state this device cannot reason
      // about. Search still works over whatever survived.
      return 0;
    }
  }, [conversationId, searchIndexStore]);
  // Enforce the budget as soon as a store exists, so a device that accumulated
  // indexes over months trims on the next conversation rather than the next
  // quota error.
  useEffect(() => {
    if (!searchIndexStore) {
      return;
    }
    let cancelled = false;
    const run = async () => {
      const evicted = await enforceIndexBudget();
      if (!cancelled && evicted > 0) {
        setStoragePressure((current) => ({
          evictedCount: current.evictedCount + evicted,
          storageFull: current.storageFull,
        }));
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [enforceIndexBudget, searchIndexStore]);

  useEffect(() => {
    if (!searchIndexStore) {
      searchWriterRef.current = null;
      return;
    }
    const writer = createMessageIndexWriter({
      conversationId,
      getPayload: (id) => messageDecryptor.get(id),
      onCoverage: () => {
        if (backfillRunningRef.current) {
          scheduleCoverageRefresh();
          return;
        }
        bumpSearchIndex();
      },
      onStorageFull: () => {
        // A write was refused for lack of space. Evict first, then report: the
        // walk can continue once something else has made room.
        setStoragePressure((current) => ({ ...current, storageFull: true }));
        void (async () => {
          const evicted = await enforceIndexBudget();
          if (evicted > 0) {
            setStoragePressure((current) => ({
              evictedCount: current.evictedCount + evicted,
              storageFull: false,
            }));
            bumpSearchIndex();
          }
        })();
      },
      store: searchIndexStore,
    });
    searchWriterRef.current = writer;
    return () => {
      searchWriterRef.current = null;
    };
  }, [
    bumpSearchIndex,
    conversationId,
    enforceIndexBudget,
    scheduleCoverageRefresh,
    searchIndexStore,
  ]);

  // Coverage of this device's index, and the walk that extends it. The walk is
  // never started automatically: it is hundreds of requests over history nobody
  // asked for, so the bar offers it and the user decides.
  const [coverage, setCoverage] = useState<BackfillProgress | null>(null);
  // Set when a write was refused for lack of storage, or when eviction had to drop
  // a conversation to stay inside the budget. Surfaced rather than swallowed: a
  // full disk used to look exactly like a conversation with no matches, with no
  // way for the user to tell the difference or act on it.
  const [storagePressure, setStoragePressure] = useState<{
    evictedCount: number;
    storageFull: boolean;
  }>({ evictedCount: 0, storageFull: false });

  const backfillRef = useRef<ReturnType<
    typeof createMessageIndexBackfill
  > | null>(null);
  const backfillAbortRef = useRef<AbortController | null>(null);

  const awaitBackfillDecrypts = useCallback(
    async (messages: MessageData[]) => {
      requestDecryptBatch(messages);
      // The writer can only index a row whose payload it can read, so the walk
      // waits for the decrypts rather than queueing rows it cannot use.
      await waitForDecrypts(messages, {
        lookup: (id) => messageDecryptor.get(id),
        subscribe: messageDecryptor.subscribe,
      });
    },
    [requestDecryptBatch]
  );

  const startIndexingOlder = useCallback(() => {
    const writer = searchWriterRef.current;
    if (!writer || !searchIndexStore || backfillRef.current) {
      return;
    }
    const controller = new AbortController();
    backfillAbortRef.current = controller;
    backfillRunningRef.current = true;
    const backfill = createMessageIndexBackfill({
      awaitDecrypts: awaitBackfillDecrypts,
      conversationId,
      // Fetched directly rather than through the transcript's infinite query:
      // the point of a backfill is to index history *without* holding it in
      // memory, and growing the transcript would defeat that.
      fetchPage: async (cursor) => {
        const page = await fetchMessages(
          conversationId,
          { cursor, kind: "older", walk: true },
          BACKFILL_PAGE_SIZE
        );
        return {
          messages: page.messages,
          previousCursor: page.previousCursor,
        };
      },
      onProgress: (next) => {
        setCoverage(next);
      },
      pageDelayMs: BACKFILL_PAGE_DELAY_MS,
      signal: controller.signal,
      store: searchIndexStore,
      writer,
    });
    backfillRef.current = backfill;
    // Not awaited: the walk is user-initiated background work, and the bar shows
    // its progress. The teardown below is what the UI depends on.
    const settle = async () => {
      try {
        await backfill.run();
      } catch {
        // The walker reports its own failures through progress; this only guards
        // against a rejection escaping the run itself.
      } finally {
        backfillRef.current = null;
        backfillAbortRef.current = null;
        backfillRunningRef.current = false;
        if (coverageTimerRef.current) {
          clearTimeout(coverageTimerRef.current);
          coverageTimerRef.current = null;
        }
        // One last read so the final page's rows are searchable immediately.
        bumpSearchIndex();
      }
    };
    void settle();
  }, [
    awaitBackfillDecrypts,
    bumpSearchIndex,
    conversationId,
    searchIndexStore,
  ]);

  // Leaving the conversation, or closing search, must not leave a walk running:
  // it would keep fetching and decrypting for a thread nobody is reading.
  useEffect(() => {
    if (searchOpen) {
      return;
    }
    backfillRef.current?.stop();
    backfillAbortRef.current?.abort();
  }, [searchOpen]);

  useEffect(
    () => () => {
      backfillRef.current?.stop();
      backfillAbortRef.current?.abort();
      if (coverageTimerRef.current) {
        clearTimeout(coverageTimerRef.current);
      }
    },
    []
  );

  // Feed every row the transcript holds to the writer. Coalesced inside the
  // writer onto a microtask, so a page of 100 arriving rows is one write.
  useEffect(() => {
    const writer = searchWriterRef.current;
    if (!writer || allMessages.length === 0) {
      return;
    }
    writer.consider(allMessages);
  }, [allMessages, searchIndexToken]);

  // One search session backs both surfaces. `enabled` tracks the whole session
  // (bar or list), so the list view inherits the bar's corpus, query, and
  // paging walk instead of standing up a second one.
  const search = useConversationSearch({
    allMessages,
    conversationId,
    enabled: searchOpen,
    hasPreviousPage: hasPreviousPage ?? false,
    indexRefreshToken: searchIndexToken,
    indexStore: searchIndexStore,
    isFetchingPreviousPage,
    loadOlderMessages,
    requestDecryptBatch,
  });
  const { matchIds } = search;

  // How much of this conversation the index can actually see, which is what the
  // bar's counter has to be honest about. Two independent signals agree on
  // coverage: a backfill that reached the start, or a transcript that paged to
  // the start (the API returning no older page means there is no older page).
  const fullyCovered =
    coverage?.reachedStart === true ||
    (hasPreviousPage === false && allMessages.length > 0);
  const indexingOlder = coverage?.state === "running";
  // Offered only when there is genuinely older history this device has not
  // indexed, and only with a store to index it into.
  const canIndexOlder =
    Boolean(searchIndexStore) && (hasPreviousPage ?? false) && !fullyCovered;

  // The list's page and its active row, resolved from the single pager helper
  // so the bar's "1/5" and the rows on screen can never disagree.
  const searchPageSlice = useMemo(
    () => paginateSearchResults(search.results, searchPage),
    [search.results, searchPage]
  );
  const searchListIndexClamped = Math.min(
    searchListIndex,
    searchPageSlice.pageResults.length - 1
  );

  // Auto-jump on commit: each newly debounced query lands on its newest match,
  // Telegram-style. Three guards keep it honest:
  //  - the debounced text must equal the live field, so the 150ms window after
  //    a cleared query never jumps to the previous query's matches;
  //  - a commit with no matches yet stays armed, because older history still
  //    indexing can surface one after the commit;
  //  - a landed match that leaves the match set (hidden, deleted) re-lands on
  //    the newest match instead of leaving the counter pointing at nothing.
  const committedQueryRef = useRef<string | null>(null);
  const pendingAutoJumpRef = useRef(false);
  useEffect(() => {
    if (!searchOpen) {
      return;
    }
    if (search.debouncedQuery.trim() !== search.query.trim()) {
      return;
    }
    if (committedQueryRef.current !== search.debouncedQuery) {
      committedQueryRef.current = search.debouncedQuery;
      pendingAutoJumpRef.current = true;
      setSearchActiveId(null);
    }
    // Nothing to land on yet: stay armed so the first match that resolves wins.
    if (matchIds.length === 0) {
      return;
    }
    const activeIndex = searchActiveId ? matchIds.indexOf(searchActiveId) : -1;
    if (pendingAutoJumpRef.current) {
      pendingAutoJumpRef.current = false;
      void jumpToMessage(matchIds[0]);
    } else if (activeIndex === -1) {
      // The landed match is no longer a match for this query (hidden or
      // deleted); re-anchor on the newest one so the counter stays truthful.
      void jumpToMessage(matchIds[0]);
    }
  }, [
    jumpToMessage,
    matchIds,
    search.debouncedQuery,
    search.query,
    searchActiveId,
    searchOpen,
  ]);

  // One navigation model for the whole session, routed by view. The chat view
  // steps matches chronologically through the transcript (wrapping, like
  // Telegram); the list view moves a cursor through the current page's rows and
  // stops at its edges, because paging there is an explicit control rather than
  // something you fall into by holding a key down.
  const stepThroughMatches = useCallback(
    (direction: 1 | -1) => {
      if (matchIds.length === 0) {
        return;
      }
      const current = searchActiveId ? matchIds.indexOf(searchActiveId) : -1;
      const from = current === -1 ? 0 : current;
      const next = (from + direction + matchIds.length) % matchIds.length;
      const id = matchIds[next];
      if (id) {
        void jumpToMessage(id);
      }
    },
    [jumpToMessage, matchIds, searchActiveId]
  );

  const moveListCursor = useCallback(
    (direction: 1 | -1) => {
      setSearchListIndex((index) => {
        const last = searchPageSlice.pageResults.length - 1;
        return Math.min(Math.max(index + direction, 0), Math.max(last, 0));
      });
    },
    [searchPageSlice.pageResults.length]
  );

  const changeSearchPage = useCallback(
    (delta: 1 | -1) => {
      setSearchPage((page) => {
        const next = paginateSearchResults(search.results, page + delta);
        return next.page;
      });
      setSearchListIndex(0);
    },
    [search.results]
  );

  const searchNext = useCallback(() => {
    if (searchView === "list") {
      moveListCursor(1);
    } else {
      stepThroughMatches(1);
    }
  }, [moveListCursor, searchView, stepThroughMatches]);

  const searchPrevious = useCallback(() => {
    if (searchView === "list") {
      moveListCursor(-1);
    } else {
      stepThroughMatches(-1);
    }
  }, [moveListCursor, searchView, stepThroughMatches]);

  // Enter: the list view jumps its highlighted row and returns to the chat to
  // reveal it; the chat view is already showing the message, so Enter just
  // steps on.
  const searchSubmit = useCallback(() => {
    if (searchView !== "list") {
      stepThroughMatches(1);
      return;
    }
    const result = searchPageSlice.pageResults[searchListIndexClamped];
    if (result) {
      setSearchView("chat");
      void jumpToMessage(result.id);
    }
  }, [
    jumpToMessage,
    searchListIndexClamped,
    searchPageSlice.pageResults,
    searchView,
    stepThroughMatches,
  ]);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchView("chat");
    setSearchPage(0);
    setSearchListIndex(0);
    setSearchActiveId(null);
    if (jumpTimerRef.current) {
      clearTimeout(jumpTimerRef.current);
      setJumpTargetId(null);
    }
    // A closed session keeps nothing: the next open starts from an empty field
    // and a re-armed auto-jump, so it never re-lands on a stale query.
    pendingAutoJumpRef.current = false;
    committedQueryRef.current = null;
    search.setQuery("");
  }, [search]);

  // Escape is a cascade: the list view is a state of the same surface, so it
  // steps back to the chat view first, and only a second Escape closes search.
  const dismissSearch = useCallback(() => {
    if (searchView === "list") {
      setSearchView("chat");
      return;
    }
    closeSearch();
  }, [closeSearch, searchView]);

  const toggleSearchView = useCallback(() => {
    setSearchView((view) => (view === "list" ? "chat" : "list"));
    setSearchListIndex(0);
  }, []);

  // Opening resets the same refs, which matters when the previous session was
  // closed by unmounting the thread or switching conversations.
  const openSearch = useCallback(() => {
    pendingAutoJumpRef.current = false;
    committedQueryRef.current = null;
    setSearchView("chat");
    setSearchPage(0);
    setSearchListIndex(0);
    setSearchActiveId(null);
    setSearchOpen(true);
  }, []);

  // One setter feeds both views, so a query typed in the bar is the same query
  // the list ranks. A new query always returns to the first page.
  const handleSearchQueryChange = useCallback(
    (query: string) => {
      search.setQuery(query);
      setSearchPage(0);
      setSearchListIndex(0);
    },
    [search]
  );

  // Landing on a result reveals it, so the list view hands back to the chat.
  const jumpFromList = useCallback(
    (messageId: string) => {
      setSearchView("chat");
      void jumpToMessage(messageId);
    },
    [jumpToMessage]
  );

  // Load one older page on demand for the viewer's "Load older images"
  // affordance. The viewer never pages history on its own, so a long thread
  // cannot be pulled in wholesale just by opening an image. The prepended page
  // is decrypted explicitly: it sits above the visible window, so the normal
  // viewport-driven decrypt effect would not reach it.
  const loadOlderMedia = useCallback(async (): Promise<boolean> => {
    if (!hasPreviousPage) {
      return false;
    }
    olderWalkRef.current = true;
    const added = await loadOlderMessages();
    if (added.length > 0) {
      requestDecryptMessages(added);
      return true;
    }
    return false;
  }, [hasPreviousPage, loadOlderMessages, requestDecryptMessages]);

  const handleViewerPosition = useCallback((index: number, total: number) => {
    setViewerPosition((current) =>
      current.index === index && current.total === total
        ? current
        : { index, total }
    );
  }, []);

  // Bound the viewer's loaded history: once the active image is far from the
  // oldest loaded one, drop the dead pages below it. Gated so it can never
  // orphan the anchor or race an older-history walk (see viewer-history-window).
  useEffect(() => {
    if (!mediaViewerKey || isFetchingPreviousPage || olderWalkRef.current) {
      return;
    }
    const { data } = messagesQuery;
    if (!data) {
      return;
    }
    const drop = pagesToDropForViewerHistory({
      activeIndex: viewerPosition.index,
      anchorMessageId: messageIdFromFlatKey(mediaViewerKey),
      findPageIndex: (id) =>
        data.pages.findIndex((page) =>
          page.messages.some((message) => message.id === id)
        ),
      pageCount: data.pages.length,
    });
    if (drop <= 0) {
      return;
    }
    queryClient.setQueryData<MessagesInfiniteData>(
      ["messages", conversationId] as const,
      (old) => {
        if (!old) {
          return old;
        }
        const { pages, pageParams } = trimOldestPages(
          old.pages,
          old.pageParams,
          drop
        );
        return { ...old, pageParams, pages };
      }
    );
  }, [
    conversationId,
    isFetchingPreviousPage,
    mediaViewerKey,
    messagesQuery.data,
    queryClient,
    viewerPosition,
    messagesQuery,
  ]);

  // Bound the transcript's own loaded history. The infinite query has no page
  // cap, so scrolling up a long conversation retains every page ever fetched
  // (measured ~102MB for a loaded 200k-message DM). Once the reader has moved
  // well clear of the oldest loaded rows, those pages are dead weight and are
  // dropped.
  //
  // Gated on the same conditions as the viewer's trim, for the same reason: a
  // page dropped while the near-top auto-loader is mid-flight, or during an
  // older walk, would be re-requested immediately and spin in a load/trim loop.
  // Dropping pages above the viewport is absorbed by the virtualizer's scroll
  // compensation, which is the mechanism the viewer's trim already relies on.
  useEffect(() => {
    if (mediaViewerKey || isFetchingPreviousPage || olderWalkRef.current) {
      return;
    }
    const { data } = messagesQuery;
    const [firstItem] = virtualItems;
    if (!data || !firstItem) {
      return;
    }
    const anchorMessageId = allMessages[firstItem.index]?.id ?? null;
    const drop = pagesToDropForTranscriptHistory({
      anchorMessageId,
      findPageIndex: (id) =>
        data.pages.findIndex((page) =>
          page.messages.some((message) => message.id === id)
        ),
      firstVisibleIndex: firstItem.index,
      pageCount: data.pages.length,
    });
    if (drop <= 0) {
      return;
    }
    queryClient.setQueryData<MessagesInfiniteData>(
      ["messages", conversationId] as const,
      (old) => {
        if (!old) {
          return old;
        }
        const { pages, pageParams } = trimOldestPages(
          old.pages,
          old.pageParams,
          drop
        );
        return { ...old, pageParams, pages };
      }
    );
  }, [
    allMessages,
    conversationId,
    isFetchingPreviousPage,
    mediaViewerKey,
    messagesQuery,
    queryClient,
    virtualItems,
  ]);

  // Close the viewer and land the transcript on the image the user was viewing.
  // Trimming while open can shift message indices, so re-anchor explicitly
  // instead of trusting the old scroll offset.
  const closeViewer = useCallback(() => {
    olderWalkRef.current = false;
    const anchorId = mediaViewerKey
      ? messageIdFromFlatKey(mediaViewerKey)
      : null;
    setMediaViewerKey(null);
    if (!anchorId) {
      return;
    }
    const index = messageIndexById.get(anchorId);
    if (index === undefined) {
      return;
    }
    requestAnimationFrame(() => {
      rowVirtualizer.scrollToIndex(index, { align: "center" });
    });
  }, [mediaViewerKey, messageIndexById, rowVirtualizer]);

  // Jump to the newest message and clear the badge. Optimistically marks the
  // viewport pinned so followOnAppend resumes tracking immediately, without
  // waiting for the smooth scroll to settle and fire a scroll event.
  const jumpToBottom = useCallback(() => {
    pinnedRef.current = true;
    setPinnedToBottom(true);
    setArrivalCount(0);
    // Smooth scrolling disables the virtualizer's own scroll compensation, so
    // animating across a growing (decrypting, imaging) list lets the viewport
    // drift. Only a short hop animates; far jumps land instantly.
    const el = scrollRef.current;
    const behavior = el
      ? jumpBehavior({
          clientHeight: el.clientHeight,
          scrollHeight: el.scrollHeight,
          scrollTop: el.scrollTop,
        })
      : "auto";
    rowVirtualizer.scrollToEnd({ behavior });
    // The in-flow typing row (when visible) sits after the virtualized list,
    // so the virtualizer's end is one row short of the true bottom. Correct
    // to the element's full height so the typing bubble stays in view.
    if (peerTyping && el) {
      requestAnimationFrame(() => {
        el.scrollTo({ top: el.scrollHeight });
      });
    }
  }, [peerTyping, rowVirtualizer]);

  // Mark the conversation read when it opens and when the peer sends while
  // the thread is open (debounced so burst sends only fire one request).
  const myUserId = user?.id;
  const scheduleRead = useCallback(() => {
    if (readDebounceRef.current) {
      clearTimeout(readDebounceRef.current);
    }
    readDebounceRef.current = setTimeout(async () => {
      try {
        await markConversationRead(conversationId);
        void queryClient.invalidateQueries({
          queryKey: ["unread-message-count"],
        });
        void queryClient.invalidateQueries({
          queryKey: ["message-conversations", myUserId],
        });
      } catch {
        // Best-effort read marking; the next open, send, or peer message
        // re-runs it, so a failed request must not become an unhandled
        // rejection.
      }
    }, 800);
  }, [conversationId, myUserId, queryClient]);

  useEffect(() => {
    scheduleRead();
    return () => {
      if (readDebounceRef.current) {
        clearTimeout(readDebounceRef.current);
      }
    };
    // scheduleRead already closes over conversationId, so its identity change
    // covers every conversation switch without listing conversationId here.
  }, [scheduleRead]);

  const handleEvent = useCallback(
    (event: {
      conversationId: string;
      kind:
        | "message.created"
        | "message.deleted"
        | "message.edited"
        | "conversation.read"
        | "conversation.delivered"
        | "typing.started"
        | "keys.rotated";
      deliveredAt?: string;
      message?: MessageData;
      readAt?: string;
      userId?: string;
    }) => {
      // The peer is typing: show it briefly. The sender's own echo is ignored.
      if (event.kind === "typing.started") {
        if (event.userId && event.userId !== user?.id) {
          setPeerTyping(true);
          if (typingTimerRef.current) {
            clearTimeout(typingTimerRef.current);
          }
          typingTimerRef.current = setTimeout(() => {
            setPeerTyping(false);
          }, 4000);
        }
        return;
      }

      // The peer confirmed receipt: advance the delivery watermark so our own
      // bubbles flip to Delivered. Our own stream already dropped the echo.
      if (event.kind === "conversation.delivered") {
        if (event.userId && event.userId !== user?.id && event.deliveredAt) {
          const deliveredAt = new Date(event.deliveredAt).getTime();
          if (!Number.isNaN(deliveredAt)) {
            setPeerMarks((current) => ({
              ...current,
              deliveredAt: advanceWatermark(current.deliveredAt, deliveredAt),
            }));
          }
        }
        return;
      }

      // The peer read the conversation: reading implies delivery, so advance
      // both watermarks. This is what flips our own bubbles to Read.
      if (event.kind === "conversation.read") {
        if (event.userId && event.userId !== user?.id && event.readAt) {
          const readAt = new Date(event.readAt).getTime();
          if (!Number.isNaN(readAt)) {
            setPeerMarks((current) => ({
              deliveredAt: advanceWatermark(current.deliveredAt, readAt),
              readAt: advanceWatermark(current.readAt, readAt),
            }));
          }
        }
        return;
      }

      const { message } = event;
      if (event.kind === "keys.rotated") {
        // A member rotated the conversation keys (first send, heal, or an
        // identity reset). Our cached detail holds the old wraps and possibly a
        // superseded peer public key, so every subsequent decrypt would fail
        // silently. Refetch the detail; the resulting identity change clears
        // the decryptor's cached roots and errors, which re-queues the payloads.
        void queryClient.invalidateQueries({
          queryKey: ["message-conversation", conversationId],
        });
        return;
      }
      if (!message) {
        return;
      }
      if (event.kind === "message.created") {
        queryClient.setQueryData<MessagesInfiniteData>(
          ["messages", conversationId] as const,
          (old) => {
            if (!old) {
              return old;
            }
            // Dedupe against the sender's own optimistic fold of the same
            // message (the SSE stream echoes every write, including ours).
            const nextPages = appendMessageToLastPage(old.pages, message);
            return nextPages ? { ...old, pages: nextPages } : old;
          }
        );
        // A message from the peer while we're looking at the thread counts as
        // read immediately and means they stopped typing.
        if (message.senderId !== user?.id) {
          setPeerTyping(false);
          scheduleRead();
          // Scrolled away from the bottom: surface how many arrived instead
          // of yanking the viewport (Telegram behavior).
          setArrivalCount((current) =>
            nextArrivalCount(current, {
              isOwn: false,
              pinned: pinnedRef.current,
            })
          );
        }
      } else if (event.kind === "message.deleted") {
        searchWriterRef.current?.remove([message.id]);
        queryClient.setQueryData<MessagesInfiniteData>(
          ["messages", conversationId] as const,
          (old) => {
            if (!old) {
              return old;
            }
            const pages = old.pages.map((page) => ({
              ...page,
              messages: page.messages.map((m) =>
                m.id === message.id ? { ...m, deletedAt: new Date() } : m
              ),
            }));
            return { ...old, pages };
          }
        );
      } else if (event.kind === "message.edited") {
        // Replace the row in place so the bubble re-renders with the new
        // ciphertext. Track whether the ciphertext actually changed: the
        // sender's own PATCH fold already patched this row, so the SSE echo of
        // that same edit must not trigger a second, redundant re-decrypt.
        let ciphertextChanged = false;
        queryClient.setQueryData<MessagesInfiniteData>(
          ["messages", conversationId] as const,
          (old) => {
            if (!old) {
              return old;
            }
            const nextPages = updateMessageInPages(old.pages, message);
            if (!nextPages) {
              return old;
            }
            const previous = old.pages
              .flatMap((page) => page.messages)
              .find((m) => m.id === message.id);
            ciphertextChanged = previous?.ciphertext !== message.ciphertext;
            return { ...old, pages: nextPages };
          }
        );
        // Only evict the cached plaintext when the row was in view AND its
        // ciphertext actually changed. The eviction makes the row's self-heal
        // effect re-request it, which decrypts the rewritten bytes with the
        // same ratchet index.
        if (ciphertextChanged) {
          messageDecryptor.invalidate(message.id);
        }
      }
    },
    [conversationId, queryClient, scheduleRead, user?.id]
  );

  useMessagesRealtime(
    conversationId,
    handleEvent,
    Boolean(user),
    // Catch up on messages published while the stream was down (mobile
    // network drops). The in-flight guard stops a reconnect from stacking a
    // refetch on top of one already running (overlapping responses can land
    // out of order and leave a stale page on screen). A real reconnect
    // reconciles regardless of cache age: the stream has no replay cursor, so
    // a gap may exist even if data was written moments ago; only the initial
    // connect leans on the mount fetch and skips on recently written data.
    useCallback(
      (isReconnect: boolean) => {
        const state = queryClient.getQueryState(["messages", conversationId]);
        if (
          !shouldCatchUp({
            dataUpdatedAt: state?.dataUpdatedAt ?? 0,
            isFetching: state?.fetchStatus === "fetching",
            isReconnect,
            now: Date.now(),
          })
        ) {
          return;
        }
        void queryClient.invalidateQueries({
          queryKey: ["messages", conversationId],
        });
      },
      [conversationId, queryClient]
    )
  );

  // Clear the typing and jump-shimmer timers when the thread unmounts.
  useEffect(
    () => () => {
      if (typingTimerRef.current) {
        clearTimeout(typingTimerRef.current);
      }
      if (jumpTimerRef.current) {
        clearTimeout(jumpTimerRef.current);
      }
    },
    []
  );

  // Ctrl+F / Cmd+F opens this DM's own search instead of the browser's
  // find-in-page, which is useless here: the transcript is virtualized, so most
  // of the page's text is not even mounted. The shortcut re-focuses an already
  // open field, so it also works as "take me back to the search box" from the
  // results list.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }
      const isFind =
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === "f";
      if (!isFind) {
        return;
      }
      // The fullscreen media viewer is its own surface; leave its browser
      // find alone rather than dropping a search bar behind the overlay.
      if (mediaViewerKey) {
        return;
      }
      event.preventDefault();
      if (searchOpen) {
        searchInputRef.current?.focus();
      } else {
        openSearch();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mediaViewerKey, openSearch, searchOpen]);

  if (!detail) {
    return <MessageThreadSkeleton />;
  }

  // The message the options menu targets, if it is still loaded (it disappears
  // if the row was hidden or trimmed while the menu was open).
  const optionsMessage = optionsTarget
    ? messagesById.get(optionsTarget.messageId)
    : undefined;
  const optionsReceipt = optionsMessage
    ? getMessageReceipt({
        createdAt: optionsMessage.createdAt,
        mine: optionsMessage.senderId === userId,
        watermarks: peerMarks,
      })
    : null;

  // 1-based counter position of the landed match, or 0 when the landed message
  // is no longer one of the current matches (query changed, or it was hidden).
  const activeIndex = searchActiveId ? matchIds.indexOf(searchActiveId) : -1;
  const searchActivePosition = activeIndex + 1;

  return (
    <ConversationMediaViewerProvider value={openConversationMedia}>
      <div className="flex h-full min-h-0 flex-1 flex-col">
        <ThreadHeader
          conversation={detail}
          onBack={onBack}
          onOpenSearch={openSearch}
          onToggleRail={onToggleRail}
          peer={peer}
          peerPresence={peerPresence}
          peerTyping={peerTyping}
          privateKey={privateKey}
        />

        {searchOpen ? (
          <MessageSearchBar
            activePosition={searchActivePosition}
            indexing={search.indexing}
            canIndexOlder={canIndexOlder}
            fullyCovered={fullyCovered}
            indexedCount={search.indexedTotal}
            indexingOlder={indexingOlder}
            inputRef={searchInputRef}
            matchCount={search.totalMatches}
            onClose={dismissSearch}
            onIndexOlder={startIndexingOlder}
            onNext={searchNext}
            onPage={changeSearchPage}
            onPrevious={searchPrevious}
            onQueryChange={handleSearchQueryChange}
            onSubmit={searchSubmit}
            onToggleView={toggleSearchView}
            page={searchPageSlice.page}
            pageCount={searchPageSlice.pageCount}
            query={search.query}
            storageEvictedCount={storagePressure.evictedCount}
            storageFull={storagePressure.storageFull}
            rangeEnd={searchPageSlice.rangeEnd}
            rangeStart={searchPageSlice.rangeStart}
            totalResults={search.results.length}
            view={searchView}
          />
        ) : null}

        <div className="relative min-h-0 flex-1">
          {/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- the transcript is a pointer gesture surface (click/double-click/right-click/slide); every real control lives in the per-row options menu, which is keyboard reachable */}
          <div
            // `overflow-anchor: none` disables the browser's own scroll
            // anchoring, which otherwise competes with the virtualizer's
            // scrollTop compensation when rows above the viewport re-measure
            // (decrypt, image load) — the two corrections fight and the
            // viewport jitters while scrolling up.
            //
            // The desktop gestures are delegated here (one listener set for the
            // whole transcript, not per row): right click opens the options
            // pane beside the message, double click replies, and a drag slides
            // to toggle multi-select. Touch has a single gesture, a tap that
            // opens the same pane. `select-none` during select mode keeps a drag
            // from starting a native text selection.
            className={cn(
              "hide-native-scrollbar h-full overflow-y-auto [overflow-anchor:none]",
              selectionActive && "select-none"
            )}
            onClick={handleTranscriptClick}
            onContextMenu={handleTranscriptContextMenu}
            onDoubleClick={handleTranscriptDoubleClick}
            onPointerCancel={handlePointerEnd}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerEnd}
            ref={scrollRef}
          >
            {allMessages.length === 0 ? (
              <div className="flex min-h-full flex-col">
                <div className="flex flex-1 flex-col items-center justify-center text-center">
                  <div className="px-6 py-5">
                    <p className="text-muted-foreground text-sm">
                      Say hi to {peer?.displayName ?? "them"}
                    </p>
                    <p className="text-muted-foreground/70 mt-1 text-xs">
                      Messages here are encrypted.
                    </p>
                  </div>
                </div>
                {peerTyping ? (
                  <TypingRow avatarUrl={peer?.avatarUrl ?? null} />
                ) : null}
              </div>
            ) : (
              <>
                <div
                  style={{
                    height: `${rowVirtualizer.getTotalSize()}px`,
                    position: "relative",
                    width: "100%",
                  }}
                >
                  {virtualItems.map((virtualItem) => {
                    const message = allMessages[virtualItem.index];
                    if (!message) {
                      return null;
                    }
                    const groupMeta = getMessageGroupMeta(
                      allMessages,
                      virtualItem.index
                    );
                    return (
                      <div
                        data-index={virtualItem.index}
                        data-message-id={message.id}
                        key={virtualItem.key}
                        ref={rowVirtualizer.measureElement}
                        style={{
                          left: 0,
                          position: "absolute",
                          top: 0,
                          transform: `translateY(${virtualItem.start}px)`,
                          width: "100%",
                        }}
                      >
                        <VirtualRow
                          conversationId={conversationId}
                          groupMeta={groupMeta}
                          highlighted={jumpTargetId === message.id}
                          historyVersion={historyVersion}
                          message={message}
                          messagesById={messagesById}
                          myUserId={userId ?? ""}
                          onEdit={handleEdit}
                          onReply={handleReply}
                          onRequest={requestDecrypt}
                          onRetry={retryDecrypt}
                          peerName={peer?.displayName ?? "them"}
                          scrolling={scrolling}
                          selected={selectedIds.has(message.id)}
                          selectionActive={selectionActive}
                        />
                      </div>
                    );
                  })}
                </div>
                {peerTyping ? (
                  <TypingRow avatarUrl={peer?.avatarUrl ?? null} />
                ) : null}
              </>
            )}
          </div>

          {isFetchingPreviousPage && !mediaViewerKey ? (
            <div className="pointer-events-none absolute inset-x-0 top-2 z-10 flex justify-center">
              <span className="panel-3d text-muted-foreground flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading older messages
              </span>
            </div>
          ) : null}

          {!pinnedToBottom && allMessages.length > 0 ? (
            <button
              aria-label={
                arrivalCount > 0
                  ? `Scroll to ${arrivalCount} new message${arrivalCount === 1 ? "" : "s"}`
                  : "Scroll to latest messages"
              }
              className="icon-btn-3d motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-75 absolute right-4 bottom-4 z-10 flex h-11 w-11 items-center justify-center rounded-full transition-transform duration-150 outline-none hover:scale-105 focus-visible:ring-2 focus-visible:ring-[hsl(var(--primary))] active:scale-95"
              onClick={jumpToBottom}
              title="Scroll to latest"
              type="button"
            >
              <ArrowDown className="h-5 w-5" />
              {arrivalCount > 0 ? (
                <span className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#ff3b30] px-1 text-[10px] font-semibold text-white tabular-nums shadow-sm">
                  {formatArrivalCount(arrivalCount)}
                </span>
              ) : null}
            </button>
          ) : null}

          {optionsMessage && optionsTarget ? (
            <MessageOptionsMenu
              anchorRect={optionsTarget.rect}
              canDeleteForEveryone={
                optionsMessage.senderId === userId && !optionsMessage.deletedAt
              }
              canEdit={
                !optionsMessage.deletedAt &&
                optionsMessage.senderId === userId &&
                isWithinEditWindow(optionsMessage.createdAt)
              }
              createdAt={optionsMessage.createdAt}
              editedAt={optionsMessage.editedAt}
              onClose={closeOptions}
              onCopy={() => handleOptionsCopy(optionsMessage)}
              onDeleteForEveryone={() =>
                requestDeleteForEveryone(optionsMessage)
              }
              onDeleteForMe={() => requestDeleteForMe(optionsMessage)}
              onEdit={() => handleEdit(optionsMessage)}
              onReply={() => handleReply(optionsMessage)}
              onSelect={() => handleOptionsSelect(optionsMessage)}
              preferEnd={optionsTarget.preferEnd}
              presentation={coarsePointer ? "sheet" : "popover"}
              receipt={optionsReceipt}
            />
          ) : null}

          {pendingDelete ? (
            <MessageDeleteDialog
              busy={deleteBusy}
              copy={messageDeleteCopy({
                count:
                  pendingDelete.scope === "for-everyone"
                    ? 1
                    : pendingDelete.messageIds.length,
                scope: pendingDelete.scope,
              })}
              onConfirm={() => {
                void confirmPendingDelete();
              }}
              onOpenChange={(open) => {
                // Ignore a dismissal while the request is in flight so the busy
                // state cannot be abandoned mid-delete. The node stays mounted
                // (pendingDelete is retained) so the close can animate and focus
                // returns to the invoker.
                if (!open && !deleteBusy) {
                  setDeleteOpen(false);
                }
              }}
              open={deleteOpen}
            />
          ) : null}

          {/* The list view is a state of the same surface, not a separate pane:
              the bar above switches its own controls, and this only swaps the
              body. Layering over the transcript (rather than replacing it)
              keeps the virtualizer's measured rows and scroll anchor, so
              jumping from a result and returning lands where it should. */}
          {searchView === "list" ? (
            <div className="absolute inset-0 z-20 flex min-h-0 flex-col bg-[hsl(var(--background))]">
              <MessageSearchResults
                activeIndex={Math.max(searchListIndexClamped, 0)}
                allMessages={allMessages}
                indexing={search.indexing}
                myUserId={userId ?? ""}
                onJump={jumpFromList}
                query={search.query}
                results={searchPageSlice.pageResults}
                truncated={search.truncated}
              />
            </div>
          ) : null}
        </div>

        {selectionActive ? (
          <div className="panel-3d mx-3 mb-2 flex items-center justify-between gap-3 rounded-xl px-3 py-2">
            <span
              aria-live="polite"
              className="text-sm font-medium tabular-nums"
            >
              {selectedIds.size} selected
            </span>
            <div className="flex items-center gap-2">
              <button
                className="btn-3d-gray inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50"
                disabled={selectedIds.size === 0}
                onClick={requestDeleteSelectedForMe}
                type="button"
              >
                <Trash2 className="size-3.5" />
                Delete for me
              </button>
              <button
                aria-label="Cancel selection"
                className="icon-btn-3d text-muted-foreground inline-flex h-8 w-8 items-center justify-center rounded-full"
                onClick={clearSelection}
                type="button"
              >
                <X className="size-4" />
              </button>
            </div>
          </div>
        ) : null}

        <MessageComposer
          conversation={detail}
          editTarget={editTarget}
          replyTarget={replyTarget}
          onEditCancel={() => setEditTarget(null)}
          onEditSave={handleEditSave}
          onReplyCancel={() => setReplyTarget(null)}
          onSent={() => {
            scheduleRead();
            // Sending always returns the user to the newest message, even from
            // mid-history, matching every mainstream chat client.
            jumpToBottom();
          }}
        />

        {mediaViewerKey ? (
          <ConversationMediaViewer
            anchorKey={mediaViewerKey}
            hasOlder={hasPreviousPage}
            isFetchingOlder={isFetchingPreviousPage}
            messages={allMessages}
            onActive={handleViewerActive}
            onClose={closeViewer}
            onLoadOlder={loadOlderMedia}
            onPosition={handleViewerPosition}
          />
        ) : null}
      </div>
    </ConversationMediaViewerProvider>
  );
}

interface VirtualRowProps {
  conversationId: string;
  groupMeta: MessageGroupMeta;
  highlighted: boolean;
  historyVersion: number;
  message: MessageData;
  messagesById: Map<string, MessageData>;
  myUserId: string;
  onEdit: (message: MessageData) => void;
  onReply: (message: MessageData) => void;
  onRequest: (message: MessageData | undefined) => void;
  onRetry: (message: MessageData) => void;
  peerName: string;
  scrolling: boolean;
  selected: boolean;
  selectionActive: boolean;
}

// Media ids whose message-conversation link this session has already asserted,
// so a recycled row does not re-POST on every mount. Keyed by conversation too
// so the same id can be re-linked if it ever surfaces in another thread (which
// the server refuses anyway). Cleared entry on failure so the next mount heals.
const linkedMessageMedia = new Set<string>();

async function ensureMessageMediaLinked(
  mediaId: string,
  conversationId: string
): Promise<void> {
  const key = `${conversationId}:${mediaId}`;
  if (linkedMessageMedia.has(key)) {
    return;
  }
  linkedMessageMedia.add(key);
  const ok = await linkMessageMedia(mediaId, conversationId);
  if (!ok) {
    linkedMessageMedia.delete(key);
  }
}

// The shared outer frame for every row variant (deleted, decrypting, error,
// rendered). In select mode it reserves a left gutter for the tick and tints
// the selected row; otherwise it is the plain padded wrapper. One frame keeps
// the selection affordance identical across variants.
function MessageRowFrame({
  children,
  divider,
  selected,
  selectionActive,
  spacingClass,
}: {
  children: React.ReactNode;
  divider: React.ReactNode;
  selected: boolean;
  selectionActive: boolean;
  spacingClass: string;
}) {
  return (
    <div
      className={cn(
        "relative",
        selectionActive ? "pr-4 pl-9" : "px-4",
        spacingClass,
        selected && "bg-[hsl(var(--primary))]/10"
      )}
    >
      {divider}
      {selectionActive ? (
        <span
          aria-hidden
          className={cn(
            "absolute top-1/2 left-3 flex size-5 -translate-y-1/2 items-center justify-center rounded-full border transition-colors",
            selected
              ? "border-transparent bg-[hsl(var(--primary))] text-white"
              : "border-border bg-[hsl(var(--background))]"
          )}
        >
          {selected ? <Check className="size-3" /> : null}
        </span>
      ) : null}
      {children}
    </div>
  );
}

// One virtualized transcript row. Subscribes to its own decrypt entry (and,
// when it quotes a reply, the parent's) so a completion batch re-renders only
// the rows whose payloads landed, never the whole visible window.
function VirtualRowInner({
  conversationId,
  groupMeta,
  highlighted,
  message,
  messagesById,
  myUserId,
  onEdit,
  onReply,
  onRequest,
  onRetry,
  peerName,
  scrolling,
  selected,
  selectionActive,
}: VirtualRowProps) {
  const mine = message.senderId === myUserId;
  const payload = useDecryptEntry(message.id);

  // Self-heal legacy unbound media. A row uploaded before the conversation
  // link existed is owner-readable but 404s for the peer; the sender's client
  // is the only party that knows the media ids, so re-assert the binding when
  // it renders its own media message. Idempotent and deduped per session.
  useEffect(() => {
    if (
      !mine ||
      !payload ||
      payload === "error" ||
      payload === "pending" ||
      payload.type !== "media"
    ) {
      return;
    }
    for (const image of getMediaImages(payload)) {
      const mediaId = getMessageMediaId(image.url);
      if (mediaId) {
        void ensureMessageMediaLinked(mediaId, conversationId);
      }
    }
  }, [conversationId, mine, payload]);

  // Self-heal: an entry can legitimately be missing while the row is mounted
  // (evicted from the LRU, dropped by scope reset, or cleared after key
  // healing). Re-request it so the bubble can never stay a permanent skeleton.
  // Not gated on `scrolling`: doing so starved prefetch during a fling and the
  // rows then decrypted all at once on settle.
  useEffect(() => {
    if (payload === undefined) {
      onRequest(message);
    }
  }, [message, onRequest, payload]);

  // Resolve the quoted parent only once our own payload names it, then ask
  // the decryptor for the parent's payload if it is not cached yet.
  const replyToId =
    payload && payload !== "error" && payload !== "pending"
      ? payload.replyToId
      : undefined;
  const parent = replyToId ? messagesById.get(replyToId) : undefined;
  const parentPayload = useDecryptEntry(parent?.id);

  useEffect(() => {
    if (parent && parentPayload === undefined) {
      onRequest(parent);
    }
  }, [onRequest, parent, parentPayload]);

  const quote = useMemo(() => {
    if (!payload || payload === "error" || payload === "pending") {
      return null;
    }
    if (!replyToId || !parent) {
      return null;
    }
    if (
      !parentPayload ||
      parentPayload === "error" ||
      parentPayload === "pending"
    ) {
      return null;
    }
    return {
      content: quoteContent(parent, parentPayload),
      senderName:
        parent.senderId === myUserId
          ? "You"
          : (parent.sender?.displayName ?? peerName),
    };
  }, [myUserId, parent, parentPayload, payload, peerName, replyToId]);

  // A reply whose own payload is decrypted but whose quoted parent has not
  // landed yet. The bubble reserves the quote's height for it so the parent
  // arriving does not re-measure the row.
  const quotePending =
    Boolean(replyToId && parent) &&
    (!parentPayload || parentPayload === "pending");

  // Grouping drives spacing and the optional time divider for every row variant
  // (deleted, decrypting, error, and rendered), so spacing never goes
  // inconsistent between them. Tighter inside a group, a slight gap between
  // groups, and a centered time pill above a paused break.
  const spacingClass = groupMeta.isLastInGroup ? "pb-3" : "pb-0.5";
  const divider = groupMeta.showTimeDivider ? (
    <TimeDivider at={message.createdAt} />
  ) : null;
  // Where this message sits in its sender-run, for the shared corner shaping.
  const position = bubblePosition(
    groupMeta.isFirstInGroup,
    groupMeta.isLastInGroup
  );
  const rounding = bubbleRoundingClasses(position, mine);
  // The peer avatar marks the end of a run (solo or bottom); earlier rows show a
  // same-width spacer so the column stays aligned. A single ternary here is
  // fine; nesting one in JSX is what the repo bans.
  const showPeerAvatar =
    !mine && (position === "solo" || position === "bottom");
  let peerAvatar: React.ReactNode = null;
  if (showPeerAvatar) {
    peerAvatar = (
      <UserAvatar avatarUrl={message.sender?.avatarUrl ?? null} size={28} />
    );
  } else {
    peerAvatar = mine ? null : <span aria-hidden className="w-7 shrink-0" />;
  }

  if (message.deletedAt) {
    return (
      <MessageRowFrame
        divider={divider}
        selected={selected}
        selectionActive={selectionActive}
        spacingClass={spacingClass}
      >
        <div
          className={cn(
            "flex items-end gap-2",
            mine ? "justify-end" : "justify-start"
          )}
        >
          {peerAvatar}
          <div
            className={cn(
              "text-muted-foreground/60 border-border/40 my-0.5 max-w-[85%] min-w-0 border border-dashed px-3.5 py-2 text-xs italic sm:max-w-[75%]",
              rounding
            )}
          >
            This message was deleted
          </div>
        </div>
      </MessageRowFrame>
    );
  }

  if (!payload || payload === "pending") {
    // Pinned to the estimate so mounting a window of undecrypted history does
    // not change the list's total extent (and therefore does not trigger the
    // virtualizer's scroll compensation). Mid-scroll the pulse is dropped: a
    // compositor animation per mounted row is pure cost while flinging.
    const pulse = scrolling ? null : "animate-pulse";
    // Pending rows pulse their avatar placeholder instead of loading an image.
    let peerAvatarSkeleton: React.ReactNode = null;
    if (showPeerAvatar) {
      peerAvatarSkeleton = (
        <div
          className={cn("bg-muted/40 h-7 w-7 shrink-0 rounded-full", pulse)}
        />
      );
    } else {
      peerAvatarSkeleton = mine ? null : (
        <span aria-hidden className="w-7 shrink-0" />
      );
    }
    return (
      <MessageRowFrame
        divider={divider}
        selected={selected}
        selectionActive={selectionActive}
        spacingClass={spacingClass}
      >
        <div
          className={cn(
            "flex items-end gap-2",
            mine ? "justify-end" : "justify-start"
          )}
          style={{ height: ESTIMATED_ROW_SIZE }}
        >
          {peerAvatarSkeleton}
          <div
            className={cn(
              "h-9 w-48",
              mine ? "bg-current opacity-10" : "bg-muted/40",
              rounding,
              pulse
            )}
          />
        </div>
      </MessageRowFrame>
    );
  }

  if (payload === "error") {
    return (
      <MessageRowFrame
        divider={divider}
        selected={selected}
        selectionActive={selectionActive}
        spacingClass={spacingClass}
      >
        <div
          className={cn(
            "flex items-end gap-2",
            mine ? "justify-end" : "justify-start"
          )}
        >
          <div
            className={cn(
              "border-border/60 bg-muted/30 flex max-w-[85%] items-center gap-2 border px-3.5 py-2 text-xs sm:max-w-[75%]",
              rounding
            )}
          >
            <span className="text-muted-foreground italic">
              Couldn&apos;t decrypt this message
            </span>
            <button
              className="text-primary font-medium hover:underline"
              onClick={() => onRetry(message)}
              type="button"
            >
              Retry
            </button>
          </div>
        </div>
      </MessageRowFrame>
    );
  }

  return (
    <MessageRowFrame
      divider={divider}
      selected={selected}
      selectionActive={selectionActive}
      spacingClass={spacingClass}
    >
      <MessageBubble
        content={payload}
        isDecrypting={false}
        jumpShimmer={highlighted}
        message={message}
        myUserId={myUserId}
        onEdit={() => onEdit(message)}
        onReply={() => onReply(message)}
        position={position}
        quote={quote}
        quotePending={quotePending}
        selectionActive={selectionActive}
      />
    </MessageRowFrame>
  );
}

// `messagesById` is a fresh Map on every message-list change, so the default
// shallow compare would re-render every visible row on each incoming message.
// Compare only what a row actually renders on: its own message identity, the
// history version (prepends can introduce a reply parent), identity, peer
// name, and the stable callbacks. Rows instead re-render from their own
// decrypt subscription when a payload lands.
const VirtualRow = memo(
  VirtualRowInner,
  (prev, next) =>
    prev.conversationId === next.conversationId &&
    prev.highlighted === next.highlighted &&
    prev.message === next.message &&
    // Grouping depends on neighbours, so an appended message can flip the
    // previous last row's isLastInGroup — and a prepend/append can flip a row's
    // isFirstInGroup — without changing its identity. Compare both flags (and
    // the divider), since the corner shaping and spacing render from them, or
    // the boundary row would keep a stale shape.
    prev.groupMeta.isFirstInGroup === next.groupMeta.isFirstInGroup &&
    prev.groupMeta.isLastInGroup === next.groupMeta.isLastInGroup &&
    prev.groupMeta.showTimeDivider === next.groupMeta.showTimeDivider &&
    prev.historyVersion === next.historyVersion &&
    prev.myUserId === next.myUserId &&
    prev.peerName === next.peerName &&
    prev.scrolling === next.scrolling &&
    prev.selected === next.selected &&
    prev.selectionActive === next.selectionActive &&
    prev.onEdit === next.onEdit &&
    prev.onReply === next.onReply &&
    prev.onRequest === next.onRequest &&
    prev.onRetry === next.onRetry
);

function ThreadHeader({
  conversation,
  onBack,
  onOpenSearch,
  onToggleRail,
  peer,
  peerPresence,
  peerTyping,
  privateKey,
}: {
  conversation: ConversationDetailResponse;
  onBack: () => void;
  onOpenSearch: () => void;
  onToggleRail: () => void;
  peer:
    | ConversationDetailResponse["conversation"]["members"][number]["user"]
    | undefined;
  peerPresence: "idle" | "online" | null;
  peerTyping: boolean;
  privateKey: CryptoKey | null;
}) {
  const { user } = useSession();
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [verified, setVerified] = useState(false);
  const [keyChanged, setKeyChanged] = useState(false);
  const myWrapped = findMyWrappedKey(conversation.keys, user?.id ?? "");
  const peerPublicKey = findPeerPublicKey(
    conversation.conversation,
    user?.id ?? ""
  );

  // Compute the (myPub, peerPub) fingerprint for out-of-band verification.
  useEffect(() => {
    let cancelled = false;
    async function compute() {
      if (!user?.id || !peerPublicKey || !myWrapped || !privateKey) {
        return;
      }
      try {
        // Export the private key's JWK and re-import it as the public key to
        // feed the fingerprint derivation. Only the public point (crv/kty/x/y)
        // is needed, so strip the private material before it touches the
        // import.
        const myJwk = await exportPublicKeyJwk(privateKey);
        const myPublicJwk = {
          crv: myJwk.crv,
          kty: myJwk.kty,
          x: myJwk.x,
          y: myJwk.y,
        };
        const myPublicKey = await importPublicKeyJwk(myPublicJwk);
        const peerPublicKeyObj = await publicKeyBase64ToJwk(peerPublicKey);
        const peerKey = await importPublicKeyJwk(peerPublicKeyObj);
        const fp = await generateFingerprint(
          myPublicKey,
          peerKey,
          peerPublicKey
        );
        if (cancelled) {
          return;
        }
        setFingerprint(fp);
        const saved = localStorage.getItem(`asm:verify:${peer?.id ?? ""}`);
        if (saved === fp) {
          setVerified(true);
        } else if (saved) {
          setKeyChanged(true);
        }
      } catch {
        // Fingerprint is best-effort; the thread still works without it.
      }
    }
    void compute();
    return () => {
      cancelled = true;
    };
  }, [myWrapped, peer?.id, peerPublicKey, privateKey, user?.id]);

  const toggleVerified = useCallback(() => {
    if (!fingerprint || !peer) {
      return;
    }
    if (verified) {
      localStorage.removeItem(`asm:verify:${peer.id}`);
      setVerified(false);
    } else {
      localStorage.setItem(`asm:verify:${peer.id}`, fingerprint);
      setVerified(true);
      setKeyChanged(false);
    }
  }, [fingerprint, peer, verified]);

  return (
    <div className="border-border/60 flex h-14 shrink-0 items-center gap-2 border-b px-3 md:px-4">
      <button
        aria-label="Back to conversations"
        className="icon-btn-3d -ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full md:hidden"
        onClick={onBack}
        title="Back to conversations"
        type="button"
      >
        <ArrowLeft className="h-4 w-4" />
      </button>

      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-center gap-1.5 text-sm font-semibold">
          <Link
            className="min-w-0 truncate hover:underline"
            href={peer ? `/users/${peer.username}` : "#"}
          >
            {peer?.displayName ?? "Conversation"}
          </Link>
          <UserBadge
            badge={peer?.badge}
            badges={peer?.badges}
            communityRoles={peer?.communityMemberships}
          />
        </p>
        {peerTyping ? (
          <p className="text-primary truncate text-xs font-medium">typing…</p>
        ) : (
          <p className="text-muted-foreground truncate text-xs">
            <Link
              className="hover:underline"
              href={peer ? `/users/${peer.username}` : "#"}
            >
              {presenceLabel(peerPresence, peer?.username)}
            </Link>
          </p>
        )}
      </div>

      {fingerprint ? (
        <button
          aria-label={verifyLabel(keyChanged, verified, fingerprint)}
          className={cnVerify(verified, keyChanged)}
          onClick={toggleVerified}
          title={verifyTitle(keyChanged, verified, fingerprint)}
          type="button"
        >
          {verifyIcon(keyChanged, verified)}
        </button>
      ) : null}

      <button
        aria-label="Search in conversation"
        className="icon-btn-3d flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
        onClick={onOpenSearch}
        title="Search in conversation"
        type="button"
      >
        <Search className="h-4 w-4" />
      </button>

      <button
        aria-label="Online friends"
        className="icon-btn-3d flex h-8 w-8 shrink-0 items-center justify-center rounded-full lg:hidden"
        onClick={onToggleRail}
        title="Online friends"
        type="button"
      >
        <Users className="h-4 w-4" />
      </button>

      <button
        aria-label="Close chat"
        className="icon-btn-3d flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
        onClick={onBack}
        title="Close chat"
        type="button"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

// In-flow typing row, rendered after the virtualized list (never overlaid),
// so it pushes the transcript up instead of covering the last message. Kept
// outside the virtualizer's measured range on purpose: the row count, keys,
// and decrypt window stay untouched, and the row mounts/unmounts without ever
// triggering scroll compensation. Same avatar size and bubble shape as a peer
// message row, so it reads as a real message.
// Centered time pill shown above a message when the conversation pauses past
// the divider window. It lives inside the message's own virtual row, so the
// virtualizer's item count stays equal to the message count and scroll
// anchoring is untouched; measureElement already absorbs the extra height.
function TimeDivider({ at }: { at: Date | string }) {
  const label = formatTimeDivider(at);
  if (!label) {
    return null;
  }
  return (
    <div className="flex justify-center pt-0.5 pb-2">
      <span className="bg-muted/70 text-muted-foreground rounded-full px-2.5 py-0.5 text-[11px] font-medium tabular-nums">
        {label}
      </span>
    </div>
  );
}

function TypingRow({ avatarUrl }: { avatarUrl: string | null }) {
  return (
    <>
      {/* oxlint-disable jsx-a11y/prefer-tag-over-role -- live typing presence is a status role; <output> is form output and the wrong semantics here */}
      <div
        className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 flex items-end gap-2 px-4 pt-1 pb-2 motion-safe:duration-300"
        role="status"
      >
        <UserAvatar avatarUrl={avatarUrl} size={28} />
        <div className="border-border/60 rounded-2xl rounded-bl-sm border bg-[hsl(var(--background))] px-4 py-3 shadow-[inset_0_1px_2px_rgba(0,0,0,0.04)]">
          <TypingDots />
        </div>
      </div>
      {/* oxlint-enable jsx-a11y/prefer-tag-over-role */}
    </>
  );
}

// Three-dot typing indicator, matching the chat bubble style.
function TypingDots() {
  return (
    <span aria-hidden="true" className="flex items-center gap-1.5">
      {[0, 1, 2].map((index) => (
        <span
          className="bg-muted-foreground/70 size-1.5 animate-bounce rounded-full motion-reduce:animate-none"
          key={index}
          style={{
            animationDelay: `${index * 0.15}s`,
            animationDuration: "1s",
          }}
        />
      ))}
    </span>
  );
}

// Single-line preview for a quoted reply message, keeping long messages from
// blowing up the quote block.
function truncateQuote(text: string, max = 90): string {
  const trimmed = text.replaceAll(/\s+/g, " ").trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

// Short label for a non-text message, used in quote blocks and reply previews.
function mediaLabel(payload: MessagePayload): string {
  if (payload.type === "post") {
    return "Shared a post";
  }
  if (payload.type === "media") {
    if (payload.kind === "gif") {
      return "Shared a GIF";
    }
    const count = getMediaImages(payload).length;
    return count > 1 ? `Shared ${count} images` : "Shared an image";
  }
  return truncateQuote(payload.content);
}

// Resolve the reply-quote body for a decrypted parent message.
function quoteContent(parent: MessageData, payload: MessagePayload): string {
  if (parent.deletedAt) {
    return "This message was deleted";
  }
  return mediaLabel(payload);
}

// Short preview of a message shown in the composer's "Replying to" bar.
function replyPreview(payload: DecryptEntry | undefined): string | undefined {
  if (!payload || payload === "error" || payload === "pending") {
    return undefined;
  }
  if (payload.type === "text") {
    return truncateQuote(payload.content, 60);
  }
  return mediaLabel(payload);
}

// Plain-text body of a decrypted payload for the options menu's copy action.
// Media and post messages may carry a caption; text messages carry their
// content. An undecrypted or failed row copies nothing rather than a
// placeholder.
function messagePlainText(payload: DecryptEntry | undefined): string {
  if (!payload || payload === "error" || payload === "pending") {
    return "";
  }
  return payload.content ?? "";
}

// Best-effort clipboard write. The API can be denied or unavailable (insecure
// context); there is nothing actionable to surface, so failures are swallowed.
async function copyToClipboard(text: string): Promise<void> {
  if (!text) {
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Best-effort.
  }
}

// Elements that keep their own click semantics. A bubbling click from one of
// these must never open the message pane or start a drag-select.
const INTERACTIVE_SELECTOR =
  "a,button,input,textarea,select,[role='menu'],[role='menuitem'],[data-no-gesture]";

function isInteractiveTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element && target.closest(INTERACTIVE_SELECTOR) !== null
  );
}

function presenceLabel(
  presence: "idle" | "online" | null,
  username: string | undefined
): string {
  if (presence === "online") {
    return "Online";
  }
  if (presence === "idle") {
    return "Idle";
  }
  return `@${username ?? ""}`;
}

function verifyLabel(
  keyChanged: boolean,
  verified: boolean,
  fingerprint: string
): string {
  if (keyChanged) {
    return "Identity key changed, tap to re-verify";
  }
  return verified ? `Verified · ${fingerprint}` : `Verify · ${fingerprint}`;
}

function verifyTitle(
  keyChanged: boolean,
  verified: boolean,
  fingerprint: string
): string {
  if (keyChanged) {
    return `Identity key changed — tap to re-verify (${fingerprint})`;
  }
  return verified
    ? `Verified · ${fingerprint}`
    : `Tap to verify · ${fingerprint}`;
}

function verifyIcon(keyChanged: boolean, verified: boolean): React.ReactNode {
  if (keyChanged) {
    return <ShieldAlert className="h-4 w-4 text-amber-500" />;
  }
  if (verified) {
    return <ShieldCheck className="h-4 w-4 text-green-500" />;
  }
  return <KeyRound className="text-muted-foreground h-4 w-4" />;
}

function cnVerify(verified: boolean, keyChanged: boolean): string {
  const base =
    "icon-btn-3d flex h-8 w-8 items-center justify-center rounded-full";
  if (keyChanged) {
    return `${base} border border-amber-500/50`;
  }
  if (verified) {
    return `${base} border border-green-500/40`;
  }
  return base;
}
