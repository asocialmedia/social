"use client";

import type { ConversationType } from "@asm/db/messages/dens";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@asm/ui/shadui/dialog";
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
import { ConversationDetailsPanel } from "@/components/messages/conversation-details-panel";
import {
  ConversationDetailsRail,
  DetailsRailToggleIcon,
} from "@/components/messages/conversation-details-rail";
import { DenAvatarCollage } from "@/components/messages/den-avatar-collage";
import {
  detailsPlacement,
  showsDetailsRailToggle,
} from "@/components/messages/details-placement";
import { MessageAccessEndedDialog } from "@/components/messages/message-access-ended-dialog";
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
import {
  DEN_UNKNOWN_SENDER_NAME,
  shouldShowSenderName,
} from "@/components/messages/message-sender-name";
import { MessageThreadSkeleton } from "@/components/messages/messages-skeleton";
import { toast } from "@/lib/gooey-toast";
import {
  ACCESS_ENDED_DISMISS_LABEL,
  ACCESS_ENDED_MESSAGE,
  accessEndedOnArrival,
  consumeSelfLeave,
  SELF_LEAVE_DESCRIPTION,
} from "@/lib/messages/access-ended";
import { reconcileAnchoredWindow } from "@/lib/messages/anchored-window";
import {
  ackMessageDelivered,
  foldMessageIntoPages,
  toCachedMessage,
  deleteMessage,
  editMessage,
  fetchConversationDetail,
  fetchDenMembershipEvents,
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
import { resolveConversationTheme } from "@/lib/messages/conversation-theme";
import {
  resolveConversationWallpaper,
  wallpaperDimOverlay,
} from "@/lib/messages/conversation-wallpaper";
import {
  editMessagePayload,
  exportPublicKeyJwk,
  generateFingerprint,
  getMediaImages,
  importPublicKeyJwk,
  importRatchetBaseKey,
  publicKeyBase64ToJwk,
} from "@/lib/messages/crypto";
import type { MessagePayload } from "@/lib/messages/crypto";
import type { DecryptEntry, DecryptItem } from "@/lib/messages/decryptor";
import {
  MESSAGE_DECRYPTOR_CACHE_CAP,
  messageDecryptor,
} from "@/lib/messages/decryptor";
import {
  denEventIsAboutMe,
  denEventLine,
} from "@/lib/messages/den-event-label";
import {
  conversationDisplayName,
  denDisplayName,
  denMemberCountLabel,
} from "@/lib/messages/den-label";
import { isWithinEditWindow } from "@/lib/messages/edit-window";
import { createHistoryReadCoordinator } from "@/lib/messages/history-read-coordinator";
import type { HistoryReadToken } from "@/lib/messages/history-read-coordinator";
import {
  isHistoryThrottled,
  isHistoryUnauthorized,
} from "@/lib/messages/history-throttle";
import { hasDeparted, ownMembership } from "@/lib/messages/membership";
import { applyMembershipSeq } from "@/lib/messages/membership-seq";
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
import {
  paginateSearchResults,
  SEARCH_PAGE_SIZE,
} from "@/lib/messages/message-search";
import { messagesTrustNote } from "@/lib/messages/messages-trust";
import {
  formatArrivalCount,
  isNearBottom,
  jumpBehavior,
  nextArrivalCount,
  PINNED_THRESHOLD_PX,
} from "@/lib/messages/scroll-state";
import { shouldAutoStartWalk } from "@/lib/messages/search-auto-walk";
import { resolveSearchIndexStore } from "@/lib/messages/search-index-backend";
import { planSearchIndexEviction } from "@/lib/messages/search-index-eviction";
import { emptySearchIndexMeta } from "@/lib/messages/search-index-format";
import type {
  DenMembershipEvent,
  MessageData,
  MessagePage,
} from "@/lib/messages/types";
import {
  firstUnreadMessageId,
  UNREAD_DIVIDER_LABEL,
} from "@/lib/messages/unread-marker";
import { useConversationSearch } from "@/lib/messages/use-conversation-search";
import { useDecryptEntry } from "@/lib/messages/use-decrypt-entry";
import {
  findMyWrappedKey,
  findMyWrappedKeys,
  findPeerPublicKey,
  useRootKeyStore,
} from "@/lib/messages/use-decryption";
import {
  catchUpKeys,
  useMessagesRealtime,
} from "@/lib/messages/use-messages-realtime";
import { usePresence } from "@/lib/messages/use-presence";
import { createViewerScanCache } from "@/lib/messages/viewer-scan-cache";
import {
  isDecryptSettled,
  waitForDecrypts,
} from "@/lib/messages/wait-for-decrypts";
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
// Newest messages inspected when a persisted "fully covered" verdict is
// verified instead of trusted. Five is enough to catch a poisoned flag --
// uncovered history at the top means the verdict is stale -- while staying a
// negligible peek next to a 500-row walk page.
const TOP_COVERAGE_PEEK_SIZE = 5;
// How long to coalesce index writes during a walk before re-reading the row
// table. Without this, every committed page would trigger a full row-table read
// and a 25-page walk would cost 25 of them.
const COVERAGE_REFRESH_DEBOUNCE_MS = 1500;
// How long the transcript's automatic fill stands down after a failed page
// before trying again. Failures settle with fetching false and unchanged
// cursors -- the exact shape that refires the auto-loaders -- so the pause is
// what keeps one rate-limit rejection from becoming a self-sustaining storm.
// Explicit jumps are unaffected and their success ends the pause early via the
// failure-count reset.
const AUTO_FILL_STAND_DOWN_MS = 5000;
// Where the desktop details pane remembers that it was folded. A window
// preference rather than a per-conversation one, so it is read once and applies to
// every thread.
const DETAILS_RAIL_COLLAPSED_KEY = "asm:dm:details-rail-collapsed";

// What a search jump is currently doing with the transcript. One owner, so the
// automatic history fill can stand down while a jump is using that loader, and
// so the loading badge is tied to an operation rather than to a network flag that
// flickers off between the sequential requests of one walk.
type JumpActivity = "anchor" | "drain" | null;

// How long a jump waits for a message it can already SEE to decrypt before it
// stops waiting and says so. Long enough for a burst of keys to arrive, short
// enough that a row whose key is unrecoverable reports itself instead of
// spinning.
const JUMP_TEXT_WAIT_MS = 4000;
// A drain that finds the history loader busy waits for it rather than declaring
// the target unreachable. Both are small because the common case is a single
// auto-fill request finishing.
const DRAIN_BUSY_RETRIES = 4;
const DRAIN_BUSY_RETRY_MS = 120;
// Delay between a drain's own pages, and the page ceiling.
//
// The drain used to issue its pages back to back with nothing in between, and
// each page is TWO requests (the previous page, and the next-page read the
// infinite query pairs with it). Thirty of those is sixty requests inside one
// rate-limit window, with the search backfill's own 500-row stream running
// underneath -- so the fallback that exists to rescue a jump was itself what
// tripped the limiter and turned "one anchored read away" into "Couldn't load
// that message". Paced like the walk, and bounded lower: a target the anchored
// read missed is nearly always already deleted, not thirty pages deep.
const DRAIN_PAGE_DELAY_MS = 150;
const DRAIN_MAX_PAGES = 8;
// One more full drain when the endpoint throttled us, after the server's own
// advice. Without it a single 429 on the last attempt ended the walk, and the
// reader was told the message does not exist.
const DRAIN_THROTTLE_RETRIES = 1;

// What a bounded walk concluded, so the bar can say something true.
//
// "unreachable" is a claim about the MESSAGE -- the walk ran its whole bounded
// budget over real pages and the row was not in any of them -- so it is only ever
// reported when no read failed. Every other outcome is about the network or the
// session, and reporting those as a missing message is the lie that made a
// throttled read look like a deleted row.
type JumpOutcome =
  | "landed"
  | "read-failed"
  | "throttled"
  | "unauthorized"
  | "unreachable";

// Classifies a history read that failed, so a jump can tell the reader what
// actually happened instead of reporting a missing message.
function jumpOutcomeForError(error: unknown): JumpOutcome {
  if (isHistoryThrottled(error)) {
    return "throttled";
  }
  if (isHistoryUnauthorized(error)) {
    return "unauthorized";
  }
  return "read-failed";
}

// The server's own throttle advice, bounded so a hostile or mistaken header
// cannot park a jump for minutes. The walk honours it exactly; this fallback
// bounds it because the user is waiting on a single row.
function throttleRetryMs(error: unknown): number {
  const asked = isHistoryThrottled(error) ? error.retryAfterSeconds : 1;
  return Math.min(asked, 5) * 1000;
}

// A bare delay. A timer has no async/await form, and this is the only place in
// the jump path that needs one.
const delay = (ms: number) =>
  // oxlint-disable-next-line promise/avoid-new -- a timer has no async/await form
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

// What a wait for one message's text concluded. Three outcomes, not two: a
// boolean said "false" for both a row that is not loaded and a row that is loaded
// but still encrypted, and the caller reported the first as a decrypt failure.
type JumpTextOutcome = "settled" | "unsettled";

// What the bar says when a jump could not show its target's text. Only a
// DECRYPT problem is named as one; an unsettled wait is still a wait, and saying
// "could not be decrypted" there is a claim the decryptor never made.
export function jumpTextErrorCopy(
  outcome: JumpTextOutcome,
  decryptState: unknown
): string {
  if (outcome === "settled") {
    return "";
  }
  return decryptState === "error"
    ? "That message's text could not be decrypted."
    : "That message's text is still loading.";
}

// What the bar says when a jump could not land its target, given how the read
// actually ended. A throttled or unauthorized read is about this device's
// network and session, not about the message, so it must not be reported as a
// message that does not exist.
export function jumpReadErrorCopy(outcome: JumpOutcome): string {
  switch (outcome) {
    case "landed": {
      return "";
    }
    case "throttled": {
      return "Too many requests. Try again in a moment.";
    }
    case "unauthorized": {
      return "Couldn't load that message. Your session may have expired.";
    }
    case "read-failed": {
      return "Couldn't load that message. Check your connection and retry.";
    }
    default: {
      return "Couldn't load that message.";
    }
  }
}

// Which read can satisfy a jump target.
//
// Exported because the ORDERING it encodes was a real bug, and the ordering is
// the whole fix: the anchored read used to look the target up in the loaded
// transcript BEFORE inserting the window it had just fetched, concluded "not
// found" for the row it was holding in its hands, and then scrolled onto a
// bubble whose text had not decrypted. Answering from the fetched window first
// is what makes the anchored read usable at all.
export function jumpTargetSource(input: {
  // Ids of the window an anchored read returned, or null before it has run.
  fetchedMessageIds: readonly string[] | null;
  // Ids the transcript already holds.
  loadedMessageIds: readonly string[];
  targetId: string;
}): "fetched" | "loaded" | "absent" {
  if (input.fetchedMessageIds?.includes(input.targetId)) {
    return "fetched";
  }
  return input.loadedMessageIds.includes(input.targetId) ? "loaded" : "absent";
}

// Whether "scroll to latest" has to fetch the newest messages before it can
// scroll to anything.
//
// A search jump replaces the whole transcript with ONE anchored page from the
// middle of history, so the virtualizer's end is the end of that page -- up to a
// hundred messages short of the present. Scrolling to it is not "the bottom of
// the conversation", it is "the bottom of the page you are looking at", and the
// user is left there with the newest messages missing. The newer-direction auto
// loader would eventually grow them back, but only if the viewport happened to
// sit near the TOP of the window, and one page at a time.
//
// `hasNextPage` is the signal, and it is the transcript's own: the first page
// carries a cursor for newer messages exactly when the window is not the tail.
// A conversation sitting at the newest message has no such cursor, so the
// ordinary case costs nothing and scrolls exactly as before.
//
// The in-flight guard is here rather than left to the caller because a
// double-click on the button is ordinary, and two concurrent tail reads would
// race their cache writes with whichever arrived second -- which is how a
// "go to latest" ends up not at the latest.
export function needsTailReturn(input: {
  hasNextPage: boolean;
  inFlight: boolean;
}): boolean {
  return input.hasNextPage && !input.inFlight;
}

// The transcript's loading prompt. Two strings, not one per mechanism: every
// read of history says the same thing to the reader, and the only genuinely
// different wait is a message whose text is still decrypting. Exported so the
// wording is testable without a transcript.
export function transcriptLoadingCopy(input: {
  isFetchingPreviousPage: boolean;
  jumpActivity: JumpActivity;
  jumpTextPending: boolean;
}): string {
  if (input.jumpTextPending) {
    return "Loading message text";
  }
  return "Loading older messages";
}

// One row of the transcript. Messages and membership log lines share the
// virtualizer so a "Bob left" line sits at the exact point in time it happened,
// between the messages either side of it. They are kept as a discriminated union
// rather than flattened into pseudo-messages because a log line has no sender, no
// ciphertext, and nothing for the receipts, search index or ratchet to read - all
// of which key off `allMessages`, which stays messages-only.
type TranscriptItem =
  | { id: string; kind: "event"; event: DenMembershipEvent }
  | { id: string; kind: "message"; message: MessageData };

// Whether the transcript has nothing to read at all.
//
// Takes the MERGED rows, not the message list, and that is the whole point. A
// den's first act is a membership line - "Alice created this den" - and it lands
// before there is a single message, so an empty state keyed off `allMessages`
// covered the one line that says what the room is. It rendered "Say hi in X" over
// the top of a den that already had a history.
//
// This is a function rather than an inline `length === 0` so the rule has one
// home and the merge cannot drift away from it again.
export function transcriptIsEmpty(
  transcript: readonly TranscriptItem[]
): boolean {
  return transcript.length === 0;
}

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
  // `accessEnded` is set when the server closed this thread's stream because
  // this member is no longer inside. Not fatal and not a reason to tear anything
  // down: the transcript is still theirs to read (a key row hangs off the
  // conversation, not the membership, which is the whole point of the removal
  // path degrading rather than bricking), so the thread stays exactly where it is
  // and only the composer goes quiet.
  //
  // Reset on a conversation switch - same as the removal, and for the same reason, so
  // a rejoin through a fresh invite code can post again.
  const [accessEndedNotice, setAccessEndedNotice] = useState(
    accessEndedOnArrival()
  );
  // The two dialogs, and the two endings they describe. One or the other, never
  // both: the stream handler below consumes the self-leave marker and routes to
  // exactly one.
  const [selfLeftNotice, setSelfLeftNotice] = useState(false);
  const [removedNotice, setRemovedNotice] = useState(false);
  useEffect(() => {
    setAccessEndedNotice(accessEndedOnArrival());
    setSelfLeftNotice(false);
    setRemovedNotice(false);
  }, [conversationId]);
  // flatKey (`messageId:imageIndex`) of the image the conversation-wide viewer
  // is anchored on, or null when closed. Stored as a key, not an index, so
  // older pages prepending never shifts the current image.
  const [mediaViewerKey, setMediaViewerKey] = useState<string | null>(null);
  // Whether the viewport is pinned to the newest message, and how many peer
  // messages have arrived since it last was (the Telegram-style badge).
  const [pinnedToBottom, setPinnedToBottom] = useState(true);
  const [arrivalCount, setArrivalCount] = useState(0);
  // The reader's read watermark as it was when this conversation opened.
  //
  // Frozen on the first render `detail` exists, because it MOVES: opening the
  // thread marks the conversation read, and a later refetch of the detail would
  // hand back the advanced value. Reading the boundary off that would erase the
  // divider a moment after painting it -- the opposite of the point, which is to
  // say where the reader left off for as long as they are looking at it. The next
  // visit has no unread messages, so the divider is gone on arrival, which is what
  // "removed once I revisit" means.
  //
  // Set during render rather than in an effect so the boundary is known in the same
  // commit the transcript first has messages. In an effect the landing below would
  // already have scrolled to the bottom and the divider would arrive as a second
  // jump.
  const [openWatermark, setOpenWatermark] = useState<
    Date | string | null | undefined
  >();
  // Whether the reader has touched the composer, which is the other way the divider
  // goes away. Local only: sending is a reason to stop saying "new messages", not a
  // reason to claim the history was read.
  const [unreadDismissed, setUnreadDismissed] = useState(false);
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
  // Bumped every time a walk settles so the auto-start effect re-evaluates
  // after the run cleared: the final progress report lands while the run
  // object still exists, which would otherwise look like "already running"
  // forever and the chain would never continue.
  const [walkEpoch, setWalkEpoch] = useState(0);
  // Whether a previous walk persisted that it reached the oldest message.
  // Null until the stored verdict is read; the auto-start waits for it so a
  // covered conversation costs nothing on reopen.
  const [persistedCovered, setPersistedCovered] = useState<boolean | null>(
    null
  );
  // Whether that verdict vouches for its own cursor chain (every page verified
  // on the way down). A covered flag without it is a legacy row: the next run
  // descends from the top once to earn it, then resumes cheaply forever after.
  const [persistedChainVerified, setPersistedChainVerified] = useState<
    boolean | null
  >(null);
  // Whether that verdict also covered the shared-refs index, which the details
  // pane's tabs read. A verdict written before refs existed is text-only, and
  // trusting it as a reason to skip the walk is what left the pane reporting "no
  // media" for conversations full of it. Absent reads as false, so the next open
  // repairs the conversation by itself.
  const [persistedRefsCovered, setPersistedRefsCovered] = useState<
    boolean | null
  >(null);
  // Whether the index writer instance exists. Auto-start must wait for it: a
  // start attempt before it does silently no-ops and never retries.
  const [writerReady, setWriterReady] = useState(false);
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
  // The last jump that could not land anywhere: anchor read and bounded walk
  // both missed. Rendered in the bar so a failed jump reads as a failure, not
  // as a transcript that stopped loading. Cleared by the next attempt, which is
  // itself the retry.
  const [jumpError, setJumpError] = useState<string | null>(null);
  // A jump is in flight right now: an anchored read, or the bounded walk behind
  // it. The bar's loader is driven by this alongside the transcript's own page
  // fetches, so a slow jump shows as work instead of as a frozen bar.
  const [jumpLoading, setJumpLoading] = useState(false);
  // What the current jump is waiting for, when the answer is not "reading
  // history". A jump onto a message that is already in the transcript spends its
  // whole time waiting for that message's TEXT to decrypt, which is a different
  // failure from a read that never came back and used to be reported as one.
  const [jumpTextPending, setJumpTextPending] = useState(false);
  // The single owner of "a search jump is using the transcript's history loader".
  // A REF first, because the automatic fill is an effect that reads this before
  // React has re-rendered with the new state, and reading render-scoped state
  // there is exactly how a second fetch got issued while a jump owned the loader.
  const jumpActivityRef = useRef<JumpActivity>(null);
  // Whether a jump is in flight AT ALL, as distinct from whether it currently owns
  // the history loader. The two come apart during a text wait, where the jump
  // deliberately hands the loader back so the badge can say what it is waiting
  // for -- and that gap is exactly when the automatic fill used to become
  // eligible and issue its own page request on the same cursor.
  const jumpInFlightRef = useRef(false);
  const [jumpActivity, setJumpActivity] = useState<JumpActivity>(null);
  const claimJumpActivity = useCallback((activity: JumpActivity) => {
    jumpActivityRef.current = activity;
    setJumpActivity(activity);
  }, []);
  // Releases the loader, but only for the jump that still owns it AND only for
  // the claim that jump made. Both checks are load-bearing: without the epoch a
  // superseded jump switches the loader off mid-flight for its replacement, and
  // without the claim a drain's teardown clears a jump that is still reading.
  const releaseJumpActivity = useCallback(
    (epoch: number, claim: JumpActivity = null) => {
      if (jumpEpochRef.current !== epoch) {
        // A newer jump owns the loader now; its own release will clear it.
        return;
      }
      if (claim !== null && jumpActivityRef.current !== claim) {
        // Someone else has the loader.
        return;
      }
      jumpActivityRef.current = null;
      setJumpActivity(null);
    },
    []
  );
  // Monotonic generation for jump requests. Jumps are async (anchored reads,
  // then a bounded older-page walk), and a second press while the first is
  // still fetching used to let both completions land: the earlier one arrived
  // last and yanked the view back to a superseded target, which reads as the
  // transcript teleporting on its own. Only the newest generation may move the
  // viewport or the current match; older ones still fetch (their pages are
  // usable data) but stay silent.
  const jumpEpochRef = useRef(0);
  // Aborts the anchored read of a superseded jump. Declared beside the epoch
  // because the two advance together: every new jump claims both.
  const jumpAbortRef = useRef<AbortController | null>(null);
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
  // Who owns the conversation's history endpoint. The search backfill reads the
  // same one, 500 rows every 250ms, from the first keystroke on a fresh device --
  // so a jump's single anchored read used to land inside a stream that was
  // already spending the rate-limit budget. The walk stands aside while a token
  // is held. Created once per mount: the readers are effects and async loops
  // that run before React re-rendered anything, and reading render-scoped state
  // there is exactly how two loaders end up on one cursor.
  // eslint-disable-next-line react/hook-use-state -- one-time instance; the setter is intentionally unused
  const [historyReads] = useState(() => createHistoryReadCoordinator());
  // A tail read from "scroll to latest" is in flight. Guards the double-click,
  // where two concurrent reads would race their cache writes and whichever lost
  // would decide where "the bottom" is. Mirrors `needsTailReturn`, which is the
  // tested form of the same rule.
  const tailReturnRef = useRef(false);
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
  // The conversation's contact card (avatar, actions, shared media/posts/links).
  // Below `lg` this is a sheet the user opens; from `lg` up it is a pane beside
  // the transcript, shown without being asked for. Mounted only while one of those
  // is showing, so its three indexes cost nothing when the user is just reading
  // the thread.
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsTabState, setDetailsTabState] = useState<{
    conversationId: string;
    tab: string;
  } | null>(null);
  // Whether this viewport pins the details pane beside the transcript, replacing
  // the online friends rail. Resolved from the media query rather than left to a
  // CSS class, because the rule is about what is MOUNTED: a display-none copy of
  // the pane would still read the refs index, keep its own cursors over the same
  // store, and count as a second consumer of the backfill walk.
  //
  // `64rem` rather than `1024px` so it tracks the `lg` class exactly -- the CSS and
  // this have to agree on one number, and `rem` is the unit the class is defined
  // in. Starts false so the first client render matches the server's, which means
  // no pane for the frame before the query resolves.
  const [desktopDetails, setDesktopDetails] = useState(false);
  // Whether the user has folded the desktop pane to its edge. Desktop only: below
  // `lg` the details are a sheet with its own dismissal, and a phone has no width
  // to fold away.
  //
  // Persisted, because it is a preference about the window rather than about the
  // conversation -- a user who folds the pane to read wants it folded on the next
  // thread too, and re-asking on every conversation is how a "remember me" flag
  // gets ignored. Read in an effect rather than as a lazy initializer so the first
  // client render matches the server's, which is the same reason the media query
  // above is not read during render.
  const [detailsCollapsed, setDetailsCollapsed] = useState(false);
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

  // Which details surface this viewport shows, as a fact rather than two
  // independent booleans: see details-placement.ts for why the interaction
  // between them has to be decided in one place.
  useEffect(() => {
    const query = window.matchMedia("(min-width: 64rem)");
    setDesktopDetails(query.matches);
    const onChange = (event: MediaQueryListEvent) =>
      setDesktopDetails(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const placement = detailsPlacement({
    collapsed: detailsCollapsed,
    desktopViewport: desktopDetails,
    requested: detailsOpen,
  });
  // Whether anything is showing, which is now the same question `placement` already
  // answered. It used to be derived separately, and the two drifted: a folded pane
  // still counted as a rail, so the walk kept fetching a conversation's whole history
  // for a pane the user had just put away.
  const detailsVisible = placement !== "none";

  // The stored preference, read once the viewport is known to be a desktop one --
  // reading it below `lg` would apply a window preference to the sheet, which has
  // its own dismissal and no width to fold.
  useEffect(() => {
    if (!desktopDetails) {
      return;
    }
    try {
      setDetailsCollapsed(
        localStorage.getItem(DETAILS_RAIL_COLLAPSED_KEY) === "1"
      );
    } catch {
      // A blocked storage (private browsing on some engines) just means the
      // preference does not survive the reload.
    }
  }, [desktopDetails]);

  const toggleDetailsRail = useCallback(() => {
    setDetailsCollapsed((collapsed) => {
      const next = !collapsed;
      try {
        localStorage.setItem(DETAILS_RAIL_COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        // Not being able to remember it is not worth an error.
      }
      return next;
    });
  }, []);

  const { data: detail } = useQuery({
    queryFn: () => fetchConversationDetail(conversationId),
    queryKey: ["message-conversation", conversationId],
    // Keys/membership are stable for a thread's lifetime; the composer
    // invalidates this explicitly after it posts new wrapped keys.
    staleTime: 5 * 60 * 1000,
  });
  const selectedDetailsTab =
    detail && detailsTabState?.conversationId === detail.conversation.id
      ? detailsTabState.tab
      : undefined;

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

  // The den's durable membership log, rendered as lines between messages. A DM
  // answers with an empty list, so this fetch is harmless there; it is enabled
  // with the thread rather than gated on the type because the type arrives with
  // the detail, and the first render would otherwise be a second round trip.
  const denEventsQuery = useQuery({
    queryFn: () => fetchDenMembershipEvents(conversationId),
    queryKey: ["den-events", conversationId] as const,
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

  // Messages and membership lines, merged in time order. Both inputs are already
  // ascending, so this is a linear merge rather than a sort. A line and a message
  // in the same millisecond put the line first: the roster moves that cause a
  // "joined"/"left" line precede the send that follows them, and a line after the
  // message it introduced would read as a correction.
  const transcriptItems = useMemo<TranscriptItem[]>(() => {
    const events = denEventsQuery.data ?? [];
    const merged: TranscriptItem[] = [];
    let messageIndex = 0;
    let eventIndex = 0;
    while (messageIndex < allMessages.length || eventIndex < events.length) {
      const message = allMessages[messageIndex];
      const event = events[eventIndex];
      if (
        event &&
        (!message || event.createdAt.getTime() <= message.createdAt.getTime())
      ) {
        merged.push({ event, id: `event-${event.id}`, kind: "event" });
        eventIndex += 1;
        continue;
      }
      if (message) {
        merged.push({ id: message.id, kind: "message", message });
        messageIndex += 1;
      }
    }
    return merged;
  }, [allMessages, denEventsQuery.data]);

  // Scroll targets need the index in the TRANSCRIPT, not in `allMessages`: the
  // virtualizer's index space is the merged one. Kept separate from
  // `messageIndexById` (which is the allMessages index the decrypt window and the
  // grouping read) because the two are different numbers the moment a log line is
  // interleaved, and silently swapping one for the other is a scroll to the wrong
  // row.
  const transcriptIndexOfMessageId = useMemo(() => {
    const map = new Map<string, number>();
    for (const [index, item] of transcriptItems.entries()) {
      if (item.kind === "message") {
        map.set(item.message.id, index);
      }
    }
    return map;
  }, [transcriptItems]);

  // A den has no single peer. Handing one to the details pane and the header
  // would address an arbitrary member as though they were the conversation, so a
  // den resolves to undefined and both surfaces take their den branch instead.
  // `firstOtherMember` survives for the one place a stand-in name IS right: the
  // quote byline for a parent whose own sender did not resolve.
  const firstOtherMember = detail?.conversation.members.find(
    (member) => member.userId !== user?.id
  );
  const peer =
    detail?.conversation.type === "DEN" ? undefined : firstOtherMember?.user;
  const conversationType = detail?.conversation.type ?? "DM";
  // The den's own name for the empty-transcript copy, resolved through the same
  // helper as the row and the header so a nameless den reads identically in all
  // three. Null for a DM, which never uses it.
  const denHeadingName =
    conversationType === "DEN" && detail
      ? denDisplayName(
          {
            members: detail.conversation.members.map((member) => ({
              avatarUrl: member.user.avatarUrl,
              displayName: member.user.displayName,
              id: member.userId,
              username: member.user.username,
            })),
            name: detail.conversation.name,
            type: "DEN",
          },
          user?.id ?? ""
        )
      : null;
  const peerPresence = peer
    ? (onlineUsers.find((u) => u.id === peer.id)?.status ?? null)
    : null;

  const userId = user?.id;

  // Whether this viewer has lost the ability to act here. Declared as early as its
  // inputs allow, because three separate places need it: the delivery ack, the
  // read scheduler, and the notice below.
  //
  // The predicate is shared rather than written inline. `leftAt` is null for a
  // current member and ABSENT on a DM row and on a payload that has not resolved,
  // and comparing it to null inline makes that absent case read as "left" - which
  // rendered every freshly opened den as read-only, permanently, because the
  // notice effect only ever sets its flag. See `hasDeparted`.
  const leftDen = hasDeparted(
    ownMembership(detail?.conversation.members ?? [], userId ?? "")
  );

  // Freeze the read watermark on the first render the conversation detail exists
  // for. Set during render rather than in an effect so the boundary is known in the
  // same commit the transcript first has messages -- in an effect, the landing below
  // would already have scrolled to the bottom and the divider would arrive as a
  // second jump.
  if (detail && openWatermark === undefined) {
    const myMember = detail.conversation.members.find(
      (member) => member.userId === userId
    );
    setOpenWatermark(myMember?.lastReadAt ?? null);
  }

  // Where the unread run starts, derived from the frozen watermark and whatever the
  // transcript currently holds.
  //
  // A derivation rather than a captured id, so it can still arrive: the newest page
  // usually loads after the conversation detail, and an id captured the moment the
  // detail resolved would be captured against an empty list. It also moves the
  // divider UP when older unread pages are prepended, which is right -- scrolling
  // into history extends the unread run rather than starting a new one.
  //
  // Null when the boundary is older than the loaded window, in which case the
  // transcript shows no divider and opens at the newest page. Reaching a boundary
  // that far back needs a read anchored on a TIME, which the history endpoint does
  // not take; the common case -- a handful of unread messages, well inside the
  // newest page -- does not need it.
  const unreadAnchorId = useMemo(
    () =>
      firstUnreadMessageId({
        lastReadAt: openWatermark,
        messages: allMessages,
        myUserId: userId ?? "",
      }),
    [allMessages, openWatermark, userId]
  );
  const showUnreadDivider = unreadAnchorId !== null && !unreadDismissed;

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
    // Not for somebody who has left, for the same reason the read receipt is
    // not: the server refuses the ack, so the only thing the attempt produced was
    // a 403 in the console of every former member who reopened an old den. What
    // it would have reported - that a message arrived - cannot be true of a
    // viewer who is not in the room to receive it.
    if (leftDen) {
      return;
    }
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
  }, [conversationId, leftDen, lastPeerMessageId]);

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
        const wrappedKeys = findMyWrappedKeys(
          detail.keys,
          detail.conversation,
          user.id
        );
        const peerPublicKey =
          findPeerPublicKey(detail.conversation, user.id) ?? "";
        if (!rootKeyStore || wrappedKeys.length === 0) {
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
      const wrappedKeys = findMyWrappedKeys(
        detail.keys,
        detail.conversation,
        userId
      );
      if (wrappedKeys.length === 0) {
        return [];
      }
      // The peer argument is only load-bearing for a DM: a den wrap pairs with
      // the key of whichever member wrapped it, so a den with one unidentified
      // member still decrypts. A DM with an unidentified peer has nothing this
      // device could read anyway.
      const peerPublicKey =
        findPeerPublicKey(detail.conversation, userId) ?? "";
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
    count: transcriptItems.length,
    estimateSize: () => ESTIMATED_ROW_SIZE,
    followOnAppend: true,
    // Must track `transcriptItems`, not a ref. The virtualizer calls setOptions
    // during render (before layout effects sync a ref), so a stale getItemKey
    // would resolve the wrong key for every index on a prepend and break the
    // end-anchor math — the viewport teleports instead of holding position. It
    // is the transcript rather than `allMessages` because a log line is a real
    // row: keying messages alone would let a line's arrival renumber every row
    // below it out from under the measured offsets.
    getItemKey: useCallback(
      (index: number) => transcriptItems[index]?.id ?? `index-${index}`,
      [transcriptItems]
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

  // Bulk request behind the details panel. Its three tabs are built from
  // decrypted payloads, and the decryptor's LRU drops rows the transcript
  // scrolled past, so a panel opened after a long scroll would list only what
  // happened to still be cached and its counts would shrink as the reader
  // scrolled. Asking for the loaded window up front makes the panel a view of the
  // loaded transcript rather than of the LRU's luck.
  //
  // Bounded, and bounded deliberately. The request asks for no more than the
  // decryptor's cache holds, newest first: a 200k-message conversation with
  // thousands of pages loaded would otherwise spend real CPU decrypting rows the
  // cache evicts before the next read, and the panel could never show them. What
  // the user gets is the newest N shared items, which is also what they are
  // looking at; older history is reachable by scrolling the thread, which loads
  // and decrypts it a page at a time. request() skips anything cached, queued, in
  // flight, or permanently failed, so a repeat call tops the window up for free.
  const requestLoadedDecrypts = useCallback(
    (messages: readonly MessageData[]) => {
      if (!detail || !rootKeyStore || !userId) {
        return;
      }
      const items: DecryptItem[] = [];
      // Walk newest to oldest and stop at the cap, so a mostly-decrypted window
      // spends its budget on rows that are actually missing.
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        if (items.length >= MESSAGE_DECRYPTOR_CACHE_CAP) {
          break;
        }
        const message = messages[index];
        if (!message || message.deletedAt) {
          continue;
        }
        if (messageDecryptor.get(message.id) === undefined) {
          items.push(toDecryptItem(message));
        }
      }
      if (items.length > 0) {
        messageDecryptor.request(items, { getBaseKeys });
      }
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
  // `urgent` serves the batch ahead of queued background work, for a caller that
  // a person is actively waiting on.
  const requestDecryptMessages = useCallback(
    (messages: MessageData[], options?: { urgent?: boolean }) => {
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
      if (items.length === 0) {
        return;
      }
      if (options?.urgent) {
        messageDecryptor.requestUrgent(items, { getBaseKeys });
        return;
      }
      messageDecryptor.request(items, { getBaseKeys });
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
  // conversation (epoch, ciphertext and pairing key per wrap) and the members'
  // public keys. When it changes, the cached roots are invalid and every failed
  // payload is worth retrying. Used both to clear the decryptor's caches and to
  // gate the stale-snapshot refetch below so a failure cannot loop forever.
  //
  // The pairing key is per wrap, not one peer: in a den each wrap was made by
  // whichever member rotated that epoch, so a change to any of them (or to the
  // wrapper a row names) invalidates what decryption depends on.
  const keySignature = useMemo(() => {
    if (!detail || !userId) {
      return "";
    }
    const wraps = findMyWrappedKeys(detail.keys, detail.conversation, userId)
      .map(
        (key) =>
          `${key.version}:${key.encryptedKey.ciphertext}:${key.encryptedKey.iv}:${key.wrapperPublicKeyBase64 ?? ""}`
      )
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
  // Whether the transcript has been taken to the unread boundary. Separate from
  // `hasLandedRef` because the boundary can resolve AFTER the first landing -- the
  // conversation detail's watermark and the newest page rarely arrive in the same
  // commit -- and that later arrival has to still be able to move the viewport, or
  // the reader is left at the bottom with the divider somewhere above them.
  const unreadLandedRef = useRef(false);
  useLayoutEffect(() => {
    if (allMessages.length === 0 || !detail) {
      return;
    }
    const unreadIndex =
      showUnreadDivider && unreadAnchorId
        ? (transcriptIndexOfMessageId.get(unreadAnchorId) ?? -1)
        : -1;
    if (unreadIndex !== -1) {
      if (unreadLandedRef.current) {
        return;
      }
      unreadLandedRef.current = true;
      // The generic landing is done too: the reader has been placed, just not at
      // the bottom.
      hasLandedRef.current = true;
      // `start` rather than `center`: the divider is the row's first child, so
      // aligning the row's top to the viewport's shows the rule and the message it
      // introduces together.
      rowVirtualizer.scrollToIndex(unreadIndex, { align: "start" });
      // Re-anchored a frame later, once the rows above have measured at their real
      // heights, which is what stops the boundary drifting the way an unmeasured
      // landing does.
      const frame = requestAnimationFrame(() => {
        rowVirtualizer.scrollToIndex(unreadIndex, { align: "start" });
      });
      return () => cancelAnimationFrame(frame);
    }
    if (hasLandedRef.current) {
      return;
    }
    hasLandedRef.current = true;
    rowVirtualizer.scrollToEnd();
    const frame = requestAnimationFrame(() => {
      rowVirtualizer.scrollToEnd();
    });
    return () => cancelAnimationFrame(frame);
  }, [
    allMessages,
    detail,
    rowVirtualizer,
    showUnreadDivider,
    transcriptIndexOfMessageId,
    unreadAnchorId,
  ]);

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
    failureCount: messagesFailureCount,
    hasNextPage,
    hasPreviousPage,
    isFetchingNextPage,
    isFetchingPreviousPage,
  } = messagesQuery;
  // Whether the transcript is actually fetching right now. Passed to the search
  // UI as `indexing` instead of the hook's structural flag (older history
  // exists and is under the cap): that flag is true for the whole session on a
  // deep conversation, so the bar's loader would spin forever and every empty
  // list would read as "still loading". A loader must mean a load.
  const transcriptFetching = isFetchingPreviousPage || isFetchingNextPage;
  // What the transcript's loading prompt says, and whether it shows at all.
  //
  // Tied to the OWNING operation rather than to `isFetchingPreviousPage`, which is
  // false in the gap between a walk's sequential pages: the prompt vanished and
  // came back for every page of a single jump, which is exactly the repeated
  // "Loading older messages" of the report. Named for the work, not the
  // mechanism -- a drain and an anchored read are both "loading older messages"
  // to the reader, and only a text wait is something else.
  // The media viewer takes the full surface and drives its own history loads, so
  // a transcript prompt under it is noise. The old condition carried that
  // exclusion; the new one has to keep it, because a jump can still own the
  // loader while the viewer is open.
  const transcriptBusy =
    !mediaViewerKey && (jumpActivity !== null || isFetchingPreviousPage);
  const transcriptLoadingLabel = transcriptLoadingCopy({
    isFetchingPreviousPage,
    jumpActivity,
    jumpTextPending,
  });
  // Timestamp until which the automatic fill stands down after a failed page,
  // plus the failure count last observed. A failed page settles with fetching
  // false and unchanged cursors -- exactly the shape that refires the loaders
  // below -- so without a stand-down every rate-limit or auth failure becomes
  // a hot retry loop that hammers the limiter harder and keeps every jump
  // stuck on "loading". `failureCount` (not `isError`: with cached data a
  // failed background fetch keeps a success status) resets on success, so
  // recovery resumes automatic filling on its own; explicit jumps still fetch
  // (they call through directly) at any time.
  const autoFillStandDownUntilRef = useRef(0);
  const autoFillSeenFailuresRef = useRef(0);
  // Cleared on a conversation change, and that is the whole point of the ref
  // holding a COUNT as well as a deadline. The count belongs to one
  // conversation's failure counter, so carrying it into the next thread means the
  // first failure there reads as "one more than we had seen" only by luck: if the
  // new conversation's counter starts lower, the stand-down never arms, and if it
  // starts equal the deadline from the OLD conversation suppresses this one for
  // the rest of the window even though nothing has failed here.
  useEffect(() => {
    autoFillStandDownUntilRef.current = 0;
    autoFillSeenFailuresRef.current = 0;
  }, [conversationId]);
  const autoFillFailedRecently = useCallback(() => {
    if (messagesFailureCount !== autoFillSeenFailuresRef.current) {
      const failed = messagesFailureCount > autoFillSeenFailuresRef.current;
      autoFillSeenFailuresRef.current = messagesFailureCount;
      if (failed) {
        autoFillStandDownUntilRef.current =
          Date.now() + AUTO_FILL_STAND_DOWN_MS;
        return true;
      }
    }
    return Date.now() < autoFillStandDownUntilRef.current;
  }, [messagesFailureCount]);
  useEffect(() => {
    // While the fullscreen viewer is open the transcript is frozen behind it,
    // and the viewer drives history loads itself. Letting the transcript's
    // near-top auto-loader fire here would race the viewer's window trim
    // (prepend, then immediately drop the same pages).
    if (mediaViewerKey) {
      return;
    }
    // A search jump owns the history loader while it reads. The auto-loader used
    // to fire anyway, because `isFetchingPreviousPage` is false in the gap
    // BETWEEN a walk's sequential pages: the jump's own page request finished, the
    // badge switched off, the effect saw "not fetching, near the top, more
    // history exists" and issued its own. Two loaders on one cursor is a
    // duplicate request, and the repeated badge was that effect firing.
    //
    // The IN-FLIGHT ref rather than the ownership ref, because a jump hands the
    // loader back for the length of its text wait -- correctly, since the badge
    // should say it is waiting on text and not on history -- and the fill used to
    // treat that handover as "nobody is reading" and step in underneath.
    if (jumpInFlightRef.current) {
      return;
    }
    if (autoFillFailedRecently()) {
      return;
    }
    if (
      virtualItems.length > 0 &&
      virtualItems[0].index < 4 &&
      hasPreviousPage &&
      !isFetchingPreviousPage
    ) {
      // A token for the fill, so the search backfill stands aside for it too: the
      // fill is the transcript reading history on the user's behalf, and letting
      // the walk compete with it is how a single page turn becomes a throttled
      // one. Released whatever happens, because a leaked token freezes the walk.
      void (async () => {
        const token = historyReads.acquire();
        try {
          await fetchPreviousPage();
        } catch {
          // The failure counter above owns reporting this; the fill's own
          // stand-down is what keeps it from refiring.
        } finally {
          historyReads.release(token);
        }
      })();
    }
  }, [
    autoFillFailedRecently,
    fetchPreviousPage,
    hasPreviousPage,
    historyReads,
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
    // Same check as the older-direction loader: growing toward the present is
    // still the same cursor the jump is walking.
    if (jumpInFlightRef.current) {
      return;
    }
    // Same failure stand-down as the older-direction loader above: without it
    // a failed newer-page fetch refires immediately and the pair of loaders
    // takes turns hammering the limiter.
    if (autoFillFailedRecently()) {
      return;
    }
    if (virtualItems.length > 0 && virtualItems[0].index < 4) {
      void (async () => {
        const token = historyReads.acquire();
        try {
          await fetchNextPage();
        } catch {
          // Owned by the failure stand-down, as above.
        } finally {
          historyReads.release(token);
        }
      })();
    }
  }, [
    autoFillFailedRecently,
    fetchNextPage,
    hasNextPage,
    historyReads,
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
  //
  // `urgent` puts the batch at the FRONT of the decryptor's queue instead of the
  // back. The background users of this function are the search backfill -- 500
  // rows a page, every 250ms -- and the corpus sweep, so a jump's own row lands
  // behind hundreds of rows nobody is waiting for and spends its four-second
  // text budget in the queue. That is the "chevron moved, no text" report on a
  // fresh index, and it is a queue-position problem, not a crypto one.
  const requestDecryptBatch = useCallback(
    (messages: MessageData[], options?: { urgent?: boolean }) => {
      if (!detail || !rootKeyStore || !userId) {
        return;
      }
      const items = messages.flatMap((message) =>
        message.deletedAt ? [] : [toDecryptItem(message)]
      );
      if (items.length > 0) {
        if (options?.urgent) {
          messageDecryptor.requestUrgent(items, { getBaseKeys });
          return;
        }
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
  //
  // The error travels with the result rather than being logged away, because the
  // two callers need opposite things from the same failure: a viewer paging
  // forward wants to try again, while a search jump has to tell "the endpoint
  // throttled us" apart from "this message is not here" before it claims the
  // message does not exist.
  const loadOlderMessages = useCallback(async (): Promise<{
    added: MessageData[];
    error: unknown;
  }> => {
    // Only `loadingOlderRef` gates concurrency. Dropping the `isFetching`
    // check keeps an awaited walk going between fetches: query state flips
    // asynchronously, so a render-scoped closure would report "busy" as "no
    // more history" and stop after a single page.
    if (loadingOlderRef.current || !hasPreviousPage) {
      return { added: [], error: null };
    }
    loadingOlderRef.current = true;
    const known = new Set(allMessages.map((message) => message.id));
    let result: Awaited<ReturnType<typeof fetchPreviousPage>> | null = null;
    let failure: unknown = null;
    try {
      result = await fetchPreviousPage();
    } catch (error) {
      failure = error;
    }
    loadingOlderRef.current = false;
    if (failure !== null) {
      return { added: [], error: failure };
    }
    const nextMessages = (result?.data?.pages ?? []).flatMap(
      (page) => page.messages
    );
    return {
      added: nextMessages.filter((message) => !known.has(message.id)),
      error: null,
    };
  }, [allMessages, fetchPreviousPage, hasPreviousPage]);

  const readFlat = useCallback((): MessageData[] => {
    const data = queryClient.getQueryData<MessagesInfiniteData>([
      "messages",
      conversationId,
    ]);
    return (data?.pages ?? []).flatMap((page) => page.messages);
  }, [conversationId, queryClient]);

  // A bounded older-page drain, shared by every jump that needs one.
  //
  // Each press used to start its own walk, and one walk is two requests (the
  // previous page, and the next-page read the infinite query pairs with it), so
  // six quick presses spent twelve requests inside one rate-limit window and
  // tripped it. One drain per burst costs what one press costs, and every target
  // pressed into it is checked against the window it grows -- so stepping
  // through matches that the anchored read cannot land on still walks history
  // once, together, instead of once per press.
  //
  // It reports WHY it stopped, because "the endpoint refused us" and "the message
  // is not in this conversation" are different facts and the bar used to collapse
  // them into the second one.
  const olderDrainRef = useRef<{
    targets: Set<string>;
    promise: Promise<JumpOutcome>;
  } | null>(null);
  const runOlderDrain = useCallback(
    (messageId: string): Promise<JumpOutcome> => {
      const running = olderDrainRef.current;
      if (running) {
        running.targets.add(messageId);
        return running.promise;
      }
      const targets = new Set([messageId]);
      const drain: NonNullable<typeof olderDrainRef.current> = {
        promise: Promise.resolve<JumpOutcome>("unreachable"),
        targets,
      };
      // The drain owns the history loader for its whole run, not one request at
      // a time. The badge and the automatic fill both read this.
      claimJumpActivity("drain");
      // And the endpoint for its whole run, so the search backfill stands aside
      // instead of spending the rate-limit budget this fallback is walking
      // through. Released unconditionally in the teardown below: a superseded
      // drain still holds a token, and a hold that is never released is exactly
      // what would freeze the walk for the rest of the session.
      const readToken: HistoryReadToken = historyReads.acquire();
      // The epoch this drain was started for. A later jump supersedes it, and
      // then this drain's own release must not clear the newer jump's claim.
      const drainEpoch = jumpEpochRef.current;
      const run = async (): Promise<JumpOutcome> => {
        // Bounded on pages, and separately on "the loader was busy". An empty
        // page used to end the walk outright, which is how a jump whose first
        // attempt collided with an in-flight auto-fill reported "Couldn't load
        // that message" for a target that was one page away.
        let busy = 0;
        let throttles = 0;
        let lastError: unknown = null;
        // oxlint-disable no-await-in-loop -- one older page in flight at a time; that is the pacing this fallback exists for
        for (
          let walks = 0;
          walks < DRAIN_MAX_PAGES && targets.size > 0;
          walks += 1
        ) {
          if (drainEpoch !== jumpEpochRef.current) {
            // A newer press owns the target now. Its own page budget is its
            // business, and this walk's pages would be requests nobody reads.
            return "unreachable";
          }
          const data = queryClient.getQueryData<MessagesInfiniteData>([
            "messages",
            conversationId,
          ]);
          if (!data?.pages[0]?.previousCursor) {
            break;
          }
          const { added, error } = await loadOlderMessages();
          if (error !== null) {
            lastError = error;
            if (
              isHistoryThrottled(error) &&
              throttles < DRAIN_THROTTLE_RETRIES
            ) {
              throttles += 1;
              // The server's own advice, honoured rather than replaced. A 429 on
              // the first attempt used to end the walk outright, which is how a
              // throttled read was reported as a message that does not exist.
              // oxlint-disable-next-line no-await-in-loop -- one bounded backoff inside the same page budget
              await delay(throttleRetryMs(error));
              // Spent a page of the budget on the wait rather than a request.
              walks -= 1;
              continue;
            }
            break;
          }
          if (added.length === 0) {
            if (busy >= DRAIN_BUSY_RETRIES) {
              break;
            }
            busy += 1;
            await delay(DRAIN_BUSY_RETRY_MS);
            walks -= 1;
            continue;
          }
          busy = 0;
          requestDecryptBatch(added);
          const flat = readFlat();
          for (const id of targets) {
            if (flat.some((message) => message.id === id)) {
              targets.delete(id);
            }
          }
          if (targets.size > 0 && walks < DRAIN_MAX_PAGES - 1) {
            // The pacing. Back to back, thirty pages is sixty requests against a
            // limiter the search backfill is already spending; with this between
            // them the same fallback costs one request per 150ms and stops
            // tripping on the way.
            // oxlint-disable-next-line no-await-in-loop -- the pacing this loop exists for
            await delay(DRAIN_PAGE_DELAY_MS);
          }
        }
        // oxlint-enable no-await-in-loop
        if (targets.size > 0) {
          // The walk ran out without finding the target, so the reason it stopped
          // decides what the bar is allowed to say.
          if (isHistoryThrottled(lastError)) {
            return "throttled";
          }
          if (lastError !== null) {
            return isHistoryUnauthorized(lastError)
              ? "unauthorized"
              : "read-failed";
          }
        }
        return "unreachable";
      };
      drain.promise = (async (): Promise<JumpOutcome> => {
        try {
          return await run();
        } finally {
          historyReads.release(readToken);
          // Cleared only if this drain is still the current one, so a drain that
          // started after this one cannot be dropped by this one's teardown.
          if (olderDrainRef.current === drain) {
            olderDrainRef.current = null;
            // Releases its OWN claim only. Comparing the value was not enough:
            // a newer jump that has already settled leaves "drain" in the ref,
            // and this teardown would then clear the loader while that jump was
            // still reading -- the auto-loader becomes eligible mid-jump, which
            // is the double-fetch this ownership exists to prevent.
            releaseJumpActivity(drainEpoch, "drain");
          }
        }
      })();
      olderDrainRef.current = drain;
      return drain.promise;
    },
    [
      claimJumpActivity,
      conversationId,
      historyReads,
      loadOlderMessages,
      queryClient,
      readFlat,
      releaseJumpActivity,
      requestDecryptBatch,
    ]
  );

  // Jump to a search result: center the row and flash its bubble. When the row
  // is not in the loaded window, one anchored read replaces the window with a
  // page centered on the target — O(limit) regardless of how deep in history it
  // sits, instead of walking every page from the newest message. The bounded
  // older-page walk stays as a fallback for a target that has since been
  // deleted or hidden, which an anchored read cannot land on.
  const jumpToMessage = useCallback(
    async (messageId: string) => {
      // Claim the generation first: anything already in flight is superseded
      // from here on and must not move the viewport when it settles.
      const epoch = jumpEpochRef.current + 1;
      jumpEpochRef.current = epoch;
      // A superseded jump's request is aborted, not just ignored on landing:
      // without this, mashing the arrows stacks one slow anchored read per
      // press, and each keeps the rate-limit budget tripped a little longer.
      jumpAbortRef.current?.abort();
      const controller = new AbortController();
      jumpAbortRef.current = controller;
      // A new attempt clears the previous failure: the press itself is the retry.
      setJumpError(null);
      // The bar's loader tracks real work, and a jump is the slowest of it: an
      // anchored read plus up to thirty walk pages, each a full request. Without
      // this the bar sits idle through a multi-second wait, which is the "it
      // did nothing" half of the glitchy-loading report.
      setJumpLoading(true);
      setJumpTextPending(false);
      jumpInFlightRef.current = true;
      claimJumpActivity("anchor");
      // And the history endpoint, for the jump's whole life -- the anchored read
      // AND the bounded walk behind it are one operation, and the backfill has to
      // stay out of the budget for both. Released by `settle` unconditionally:
      // the epoch guard below is about the UI, and a superseded jump whose token
      // is never dropped would hold the walk off for the rest of the session.
      const readToken: HistoryReadToken = historyReads.acquire();
      // Cleared only by the jump that still owns the epoch. A superseded attempt
      // that cleared it would switch the loader off mid-flight for the jump
      // that replaced it, and one that did not clear it would strand the loader
      // if the newer jump never finishes.
      const settle = () => {
        historyReads.release(readToken);
        // Unconditional, like the token: a superseded jump's settle is skipped for
        // the UI's sake, and leaving this set would stand the automatic fill down
        // for the rest of the session.
        jumpInFlightRef.current = false;
        if (epoch === jumpEpochRef.current) {
          setJumpLoading(false);
          setJumpTextPending(false);
          releaseJumpActivity(epoch);
        }
      };
      // Waits for a SPECIFIC row's text, and reports which of the three things
      // happened. It took the row as an argument rather than looking it up
      // because the anchored read used to call this BEFORE putting the fetched
      // window in the cache -- so the lookup could not see the very row it had
      // just fetched, and the jump landed on text that was still encrypted. It
      // also used to answer `false` for both "not loaded" and "not decrypted",
      // and the caller reported the first as a decrypt failure.
      const awaitTargetText = async (
        target: MessageData
      ): Promise<JumpTextOutcome> => {
        // Urgent, and for the same reason the anchored window below is: this is
        // the one row the user is waiting on, and the background lane is a
        // backfill page deep.
        requestDecryptBatch([target], { urgent: true });
        if (isDecryptSettled(messageDecryptor.get(target.id))) {
          return "settled";
        }
        // No history request is in flight while only text is being waited on, so
        // this jump's own claim is released: the prompt changes to the text wait
        // rather than sitting on "Loading older messages" for four seconds.
        // Released BY CLAIM, not unconditionally -- a concurrent jump's drain
        // owns the loader here, and clearing the shared ref would hand the
        // auto-loader a free hand mid-walk.
        releaseJumpActivity(jumpEpochRef.current, "anchor");
        setJumpTextPending(true);
        await waitForDecrypts([target], {
          lookup: (id) => messageDecryptor.get(id),
          subscribe: messageDecryptor.subscribe,
          timeoutMs: JUMP_TEXT_WAIT_MS,
        });
        return isDecryptSettled(messageDecryptor.get(target.id))
          ? "settled"
          : "unsettled";
      };
      // The loaded row for the target, or null. Read on demand because every
      // call site cares about the window as it is NOW, not as it was when the
      // jump started.
      const loadedTarget = (): MessageData | null =>
        readFlat().find((message) => message.id === messageId) ?? null;
      let index = readFlat().findIndex((message) => message.id === messageId);
      // Whether the anchored read below failed, and why. Collected rather than
      // swallowed so a jump that cannot land can say something true: the fallback
      // has to know the anchor was refused by the network rather than genuinely
      // missing the row, and the bar has to be able to say so.
      let anchorError: unknown = null;
      if (index !== -1) {
        // Already on screen. The only thing that can be missing is its text, and
        // that is a decrypt wait rather than a history read -- the old code went
        // straight to the anchored read here, replaced the whole window with one
        // centred on a message already in it, and reported failure whenever the
        // replacement did not contain the row.
        const target = loadedTarget();
        // Absent now, though it was on screen a moment ago: the window was
        // replaced underneath this jump. Fall through to the anchored read
        // rather than reporting a decrypt problem for a row nobody has.
        if (target) {
          const outcome = await awaitTargetText(target);
          if (epoch !== jumpEpochRef.current) {
            settle();
            return;
          }
          if (outcome !== "settled") {
            settle();
            setJumpError(
              jumpTextErrorCopy(outcome, messageDecryptor.get(messageId))
            );
            return;
          }
          index = readFlat().findIndex((m) => m.id === messageId);
        }
      }
      if (index === -1) {
        try {
          const window = await fetchMessages(
            conversationId,
            { kind: "around", messageId },
            HISTORY_PAGE_SIZE,
            { signal: controller.signal }
          );
          if (window.messages.length > 0) {
            // The window becomes the loaded transcript BEFORE the text wait, so
            // the wait has a row to look at: it used to run first, against a
            // cache that did not contain the row it had just fetched, and then
            // its "not found" answer was ignored -- leaving the jump to scroll
            // onto a bubble whose text had not decrypted yet.
            //
            // pageParams[0] is the sentinel for "this is a window, not the
            // newest page", and both cursors on the page drive the auto-loaders
            // from here.
            // Asked of the fetched window explicitly, before the cache swap
            // below decides anything: this is the answer that used to be taken
            // from the cache and came back "not found".
            const loadedNow = readFlat().map((message) => message.id);
            const source = jumpTargetSource({
              fetchedMessageIds: window.messages.map((message) => message.id),
              loadedMessageIds: loadedNow,
              targetId: messageId,
            });
            // What the transcript held when the read went out, so the write below
            // can tell a message that ARRIVED while it was in flight from one it
            // already had. The blind write this replaces discarded both, and a
            // peer message folded in during the read simply vanished from the
            // screen while the badge said it had arrived.
            const issuedIds = new Set(loadedNow);
            queryClient.setQueryData<MessagesInfiniteData>(
              ["messages", conversationId],
              (old) => {
                if (!old) {
                  return old;
                }
                return {
                  pageParams: [NEWEST_PAGE],
                  pages: [
                    reconcileAnchoredWindow({
                      currentPages: old.pages,
                      fetched: window,
                      issuedIds,
                    }),
                  ],
                };
              }
            );
            // The window's own decrypts are urgent: this jump is about to wait on
            // one of them, and on a fresh device the backfill has hundreds queued
            // ahead of it.
            requestDecryptBatch(window.messages, { urgent: true });
            if (source !== "absent") {
              const landed = loadedTarget();
              if (landed) {
                // The outcome is USED, which it was not: the anchored path
                // discarded it and scrolled onto a bubble whose text had not
                // decrypted, with no badge and no message. That is the "chevron
                // with no text" report. A row that is genuinely undecryptable now
                // says so, and one that is merely slow lands and fills in when
                // its payload resolves.
                const outcome = await awaitTargetText(landed);
                if (outcome !== "settled") {
                  settle();
                  if (epoch === jumpEpochRef.current) {
                    setJumpError(
                      jumpTextErrorCopy(
                        outcome,
                        messageDecryptor.get(messageId)
                      )
                    );
                  }
                  return;
                }
              }
            }
            index = readFlat().findIndex((m) => m.id === messageId);
          }
        } catch (error) {
          anchorError = error;
          // Fall through to the bounded walk below: a failed anchor read must
          // not make the jump a dead end when the target is reachable by paging.
          // A superseded jump stops here instead of walking: its target no
          // longer matters, and each walk page is another request against the
          // same budget the new jump needs.
          if (controller.signal.aborted || epoch !== jumpEpochRef.current) {
            settle();
            return;
          }
        }
      }
      let drainOutcome: JumpOutcome = "unreachable";
      if (index === -1) {
        // The target is reachable only by paging: an anchored read cannot land
        // on a row the transcript will not serve, and the shared drain walks
        // older pages until this target is in the window. A newer press joins
        // the same drain rather than starting another one.
        drainOutcome = await runOlderDrain(messageId);
        index = readFlat().findIndex((m) => m.id === messageId);
      }
      if (index === -1) {
        // Nothing landed. Said out loud in the bar, and said TRUE: a walk that
        // stopped because the endpoint throttled us or the session expired is not
        // evidence that the message is gone, and reporting it as one is what made
        // a rate-limited read look like a deleted row. A silent return is worse
        // still -- the transcript sits where it was with the spinner gone, which
        // reads as a hang. Superseded jumps stay silent: a newer press owns the UI.
        settle();
        if (epoch === jumpEpochRef.current) {
          setJumpError(
            jumpReadErrorCopy(
              // The drain's own verdict wins: it is the one that walked the
              // pages. The anchor's error only speaks for the anchor, and the
              // fallback may well have recovered from it.
              drainOutcome === "unreachable" && anchorError !== null
                ? jumpOutcomeForError(anchorError)
                : drainOutcome
            )
          );
        }
        return;
      }
      // A superseded jump stays silent: a newer press already owns the
      // viewport, and landing here would yank the view back to a target the
      // user has moved past. The fetched pages stay in the cache regardless.
      if (epoch !== jumpEpochRef.current) {
        settle();
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
      rowVirtualizer.scrollToIndex(
        transcriptIndexOfMessageId.get(messageId) ?? index,
        {
          align: "center",
          behavior: "auto",
        }
      );
      // Re-anchor on the next frame: the target row may still be at its
      // estimated height (pending decrypt), and the first landing uses that
      // estimate. Same pattern as the viewer's close-and-land. Gated on the
      // generation for the same reason as the landing above: a newer jump may
      // have claimed the viewport in the meantime.
      requestAnimationFrame(() => {
        if (epoch !== jumpEpochRef.current) {
          return;
        }
        rowVirtualizer.scrollToIndex(
          transcriptIndexOfMessageId.get(messageId) ?? index,
          {
            align: "center",
            behavior: "auto",
          }
        );
      });
      settle();
    },
    [
      conversationId,
      queryClient,
      readFlat,
      requestDecryptBatch,
      rowVirtualizer,
      runOlderDrain,
      claimJumpActivity,
      historyReads,
      releaseJumpActivity,
      transcriptIndexOfMessageId,
    ]
  );

  // Resolve the index backend once per conversation. A failure here is not
  // fatal: `resolveSearchIndexStore` already falls back to an in-memory store,
  // and the caller treats null as "no index, loaded rows only".
  useEffect(() => {
    let cancelled = false;
    setPersistedCovered(null);
    setPersistedChainVerified(null);
    setPersistedRefsCovered(null);
    const resolve = async () => {
      try {
        const resolved = await resolveSearchIndexStore();
        if (cancelled) {
          return;
        }
        setSearchIndex({ refreshToken: 0, store: resolved.store });
        // Whether a previous walk already reached the start, so reopening
        // search on a covered conversation starts nothing -- not even the
        // one-request probe walk that would rediscover it. A persisted "done"
        // is verified against the newest page rather than trusted blindly: a
        // cursor that pointed below uncovered history poisons the flag with it,
        // and trusting it would strand everything above forever.
        try {
          const meta = await resolved.store.readMeta(conversationId);
          let covered = meta?.reachedStart === true;
          let chainVerified = meta?.cursorVerified === true;
          if (covered && !cancelled) {
            try {
              const peek = await fetchMessages(
                conversationId,
                { kind: "older" },
                TOP_COVERAGE_PEEK_SIZE
              );
              const topIds = peek.messages.map((row) => row.id);
              if (topIds.length > 0) {
                const indexedTop = await resolved.store.hasIndexedMessages(
                  conversationId,
                  topIds
                );
                let queued: string[] = [];
                try {
                  queued = await resolved.store.readPending(conversationId);
                } catch {
                  // Unreadable queue: covered means indexed, below.
                }
                const queuedSet = new Set(queued);
                covered = topIds.every(
                  (id) => indexedTop.has(id) || queuedSet.has(id)
                );
              }
            } catch {
              // Peek failed: keep the persisted verdict rather than forcing a
              // heal walk on a network blip.
            }
            if (!covered) {
              chainVerified = false;
              try {
                const current =
                  (await resolved.store.readMeta(conversationId)) ??
                  emptySearchIndexMeta(conversationId);
                await resolved.store.writeMeta({
                  ...current,
                  cursorVerified: false,
                  reachedStart: false,
                  // Cleared with the verdict it belonged to. Leaving a refs
                  // marker on a conversation whose coverage was just disproved
                  // would let a later run skip the repair this write is for.
                  refsReachedStart: false,
                  updatedAt: Date.now(),
                });
              } catch {
                // Best effort: the walk re-verifies from the top regardless.
              }
            }
          }
          if (!cancelled) {
            setPersistedCovered(covered);
            setPersistedChainVerified(chainVerified);
            // Read as false when absent, so an older verdict that predates refs
            // heals rather than persisting.
            setPersistedRefsCovered(meta?.refsReachedStart === true && covered);
          }
        } catch {
          if (!cancelled) {
            setPersistedCovered(false);
            setPersistedChainVerified(false);
            setPersistedRefsCovered(false);
          }
        }
      } catch {
        // Both backends unavailable. Search still works over loaded rows.
        if (!cancelled) {
          setSearchIndex(null);
          setPersistedCovered(false);
          setPersistedChainVerified(false);
          setPersistedRefsCovered(false);
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
      setWriterReady(false);
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
      // Retries pending rows the moment their payload lands, rather than waiting
      // for unrelated transcript activity. A conversation that had gone quiet
      // would otherwise never catch up on rows it had already fetched.
      subscribeToPayloads: messageDecryptor.subscribe,
    });
    searchWriterRef.current = writer;
    setWriterReady(true);
    return () => {
      searchWriterRef.current = null;
      setWriterReady(false);
    };
  }, [
    bumpSearchIndex,
    conversationId,
    enforceIndexBudget,
    scheduleCoverageRefresh,
    searchIndexStore,
  ]);

  // Coverage of this device's index, and the walk that extends it. Opening
  // search starts the walk on its own and each yielded run chains the next
  // while search stays open; the bar shows progress throughout, and closing
  // search (or hiding the tab) ends it. There is no manual stop: indexing is
  // automatic and stops itself.
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
    // The walk is about to commit once per page, and every commit takes the
    // IndexedDB write lock. Holding the writer's own coalesced writes for the
    // duration keeps the transcript's decryptor completions from adding a
    // parallel stream of commits that contend for the same lock and starve
    // search reads. The walk's per-page flush writes everything queued, so
    // nothing is deferred past the walk.
    writer.setDeferring(true);
    const backfill = createMessageIndexBackfill({
      awaitDecrypts: awaitBackfillDecrypts,
      // The walk stands aside for a user-initiated read. It shares this
      // conversation's history endpoint, and on a fresh device it owns the
      // rate-limit budget from the first keystroke: 500-row pages, 250ms apart,
      // for as long as search stays open. Without this the user's single anchored
      // read arrives into that stream, is throttled, and falls back to a bounded
      // walk that then spends thirty more requests against the same limiter --
      // which is the "loading messages" that eventually gives up on its own.
      beforePage: () => historyReads.whenIdle(controller.signal),
      conversationId,
      // Fetched directly rather than through the transcript's infinite query:
      // the point of a backfill is to index history *without* holding it in
      // memory, and growing the transcript would defeat that.
      fetchPage: async (cursor) => {
        const page = await fetchMessages(
          conversationId,
          { cursor, kind: "older", walk: true },
          BACKFILL_PAGE_SIZE,
          // The run's signal reaches the in-flight request, not just the walk's
          // between-page waits: closing search or hiding the tab ends the fetch
          // that is hanging, instead of waiting out a 30s page that nobody
          // will read.
          { signal: controller.signal }
        );
        return {
          messages: page.messages,
          previousCursor: page.previousCursor,
        };
      },
      onProgress: (next) => {
        setCoverage(next);
        if (next.reachedStart) {
          // Reached bottom through this run's verified descent, so the flag
          // and the chain verdict go together from here on.
          setPersistedCovered(true);
          setPersistedChainVerified(true);
          // And the refs half, for the same reason: this run wrote each message's
          // media, posts and links in the same pass it wrote the text, so it
          // covered both indexes and the pane can stop offering to index older.
          setPersistedRefsCovered(true);
        }
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
        // Released in the walk's own settle, so an abort or a page-budget yield
        // both give the writer back rather than leaving it holding writes for a
        // walk that is no longer running.
        writer.setDeferring(false);
        if (coverageTimerRef.current) {
          clearTimeout(coverageTimerRef.current);
          coverageTimerRef.current = null;
        }
        // One last read so the final page's rows are searchable immediately.
        bumpSearchIndex();
        // Retrigger the auto-start effect: the run's final report landed while
        // the run object still existed, so without this the chain would see
        // "already running" forever and never continue.
        setWalkEpoch((epoch) => epoch + 1);
      }
    };
    void settle();
  }, [
    awaitBackfillDecrypts,
    bumpSearchIndex,
    conversationId,
    historyReads,
    searchIndexStore,
  ]);

  // Leaving the conversation, or closing EVERY consumer, must not leave a walk
  // running: it would keep fetching and decrypting for a thread nobody is reading.
  // The report is cleared too: it belongs to the ended session, and a stale
  // `stopped` would veto the next session's auto-start.
  //
  // "Every" rather than "search", because the details surface reads the same
  // index: closing search while the details are showing must not stop a walk whose
  // output the user is still looking at. `detailsVisible` rather than `placement`
  // because the pinned pane is a consumer without the user ever asking for it, and
  // because a pane the user has folded is not a consumer at all.
  const walkWanted = searchOpen || detailsVisible;
  useEffect(() => {
    if (walkWanted) {
      return;
    }
    backfillRef.current?.stop();
    backfillAbortRef.current?.abort();
    setCoverage(null);
  }, [walkWanted]);

  // A hidden tab does no walks: decrypting hundreds of pages for a screen
  // nobody is looking at is battery and bandwidth spent for nothing. Becoming
  // visible restarts the current run's successor through the auto-start below
  // (a stopped run never chains on its own, so without this the walk would
  // wait for search to reopen).
  useEffect(() => {
    if (!walkWanted) {
      return;
    }
    const onVisibilityChange = () => {
      if (document.hidden) {
        backfillRef.current?.stop();
        backfillAbortRef.current?.abort();
        return;
      }
      if (
        shouldAutoStartWalk({
          autoIndex: true,
          coverage,
          persistedChainVerified,
          persistedCovered,
          persistedRefsCovered,
          running: backfillRef.current !== null,
          storeReady: searchIndexStore !== null,
          // The tab is visible and a consumer is open, which is exactly the
          // condition the policy asks about.
          wantsIndexing: true,
          writerReady,
        })
      ) {
        startIndexingOlder();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [
    coverage,
    persistedChainVerified,
    persistedCovered,
    persistedRefsCovered,
    searchIndexStore,
    startIndexingOlder,
    walkWanted,
    writerReady,
  ]);

  // Automatic catch-up. Opening search OR the details panel on partially covered
  // history starts the walk, and each run that yields on its page budget chains
  // the next while a consumer stays open -- the 25-page bound paces the work,
  // chaining only removes the clicks. Failed runs never chain (the Retry button
  // owns them); there is no manual stop by design, so the flag below is always
  // true and stopping only ever comes from close, hide, or teardown.
  //
  // The details surface counts as a consumer because its tabs read this same
  // index. Without it, showing the details on a device that has never walked the
  // conversation would show only the decrypted slice and report "no media" for a
  // chat full of it -- the exact false answer the walk exists to prevent. On a
  // desktop this is now the default view, so this walk starts on entering a
  // conversation rather than on opening a panel -- and folding the pane withdraws
  // the consumer, which stops the walk again.
  const wantsIndexing = searchOpen || detailsVisible;
  useEffect(() => {
    if (
      shouldAutoStartWalk({
        autoIndex: true,
        coverage,
        persistedChainVerified,
        persistedCovered,
        persistedRefsCovered,
        running: backfillRef.current !== null,
        storeReady: searchIndexStore !== null,
        wantsIndexing,
        writerReady,
      })
    ) {
      startIndexingOlder();
    }
  }, [
    coverage,
    persistedChainVerified,
    persistedCovered,
    persistedRefsCovered,
    searchIndexStore,
    startIndexingOlder,
    walkEpoch,
    wantsIndexing,
    writerReady,
  ]);

  useEffect(
    () => () => {
      backfillRef.current?.stop();
      backfillAbortRef.current?.abort();
      jumpAbortRef.current?.abort();
      // Every holder is gone with the component, and their teardowns will never
      // run. A token left behind would hold the backfill off for the rest of the
      // session -- and this instance outlives nothing, so nothing would clear it.
      historyReads.reset();
      if (coverageTimerRef.current) {
        clearTimeout(coverageTimerRef.current);
      }
    },
    [historyReads]
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

  // Rows persisted as unsearchable by an earlier session are retried as soon as
  // the transcript holds them again, rather than waiting for the user to scroll
  // back to them. Rows outside the loaded window are recovered by the backfill
  // walk instead, which re-fetches from its cursor: fetching each pending id
  // individually would turn a 5,000-row queue into 5,000 requests.
  useEffect(() => {
    const writer = searchWriterRef.current;
    if (!writer || allMessages.length === 0) {
      return;
    }
    let cancelled = false;
    const recover = async () => {
      let queued: string[];
      try {
        queued = await writer.durablePending();
      } catch {
        return;
      }
      if (cancelled || queued.length === 0) {
        return;
      }
      const queuedSet = new Set(queued);
      const retryable = allMessages.filter((row) => queuedSet.has(row.id));
      if (retryable.length > 0) {
        writer.consider(retryable);
      }
    };
    void recover();
    return () => {
      cancelled = true;
    };
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
    listPage: searchView === "list" ? searchPage : 0,
    requestDecryptBatch,
  });
  const { matchIds } = search;

  // A jump outlives the session that asked for it unless the session ends here.
  // Closing search, switching conversations, or committing a new query all
  // supersede the in-flight target: the next jump claims the epoch anyway, but
  // the walk's own page requests belong to the old target and are the ones
  // worth cancelling. Clearing the loader here matters as much as the abort --
  // a bar that reopens mid-flight would otherwise spin forever. Keyed on the
  // DEBOUNCED query, not the field: typing must not cancel a jump, but the
  // commit that puts the results on screen must.
  useEffect(() => {
    jumpAbortRef.current?.abort();
    jumpAbortRef.current = null;
    // The drain walks THIS conversation's transcript, so a drain left over from
    // the last one would page the new conversation looking for a target from the
    // old one. Its targets are dropped, which ends the loop at the next check.
    if (olderDrainRef.current) {
      olderDrainRef.current.targets.clear();
    }
    // The activity claim as well: leaving it set keeps the automatic history
    // fill suppressed for the next session, and leaving the text wait set leaves
    // the transcript badge up with no jump behind it.
    jumpActivityRef.current = null;
    jumpInFlightRef.current = false;
    setJumpActivity(null);
    setJumpLoading(false);
    setJumpTextPending(false);
    // The history-read tokens as well, for the same reason plus one more: the
    // holders' teardowns are skipped on a supersede (that is what keeps a stale
    // jump from clearing a newer one), so a token taken for a query the user has
    // already left would otherwise hold the walk off until the component unmounts
    // -- which, mid-session, is never.
    historyReads.reset();
  }, [conversationId, historyReads, search.debouncedQuery, searchOpen]);

  // How much of this conversation the index can actually see, which is what the
  // bar's counter has to be honest about. Three signals agree on coverage: a
  // backfill that reached the start this session, a vouched persisted verdict
  // from an earlier session (covered flag plus verified cursor chain -- either
  // half missing means the walk must re-prove it), or a transcript that paged
  // to the start (the API returning no older page means there is no older page).
  // All three verdict halves, for the same reason the walk needs all three: a
  // conversation whose TEXT is covered but whose refs are not is not covered as
  // far as anything on screen can tell, and reporting it as covered is what put
  // "no media" on a chat full of it.
  const fullyCovered =
    (coverage?.reachedStart === true && coverage.refsReachedStart === true) ||
    (persistedCovered === true &&
      persistedChainVerified === true &&
      persistedRefsCovered === true) ||
    (hasPreviousPage === false && allMessages.length > 0);
  const indexingOlder = coverage?.state === "running";
  // Offered only when there is genuinely older history this device has not
  // indexed, and only with a store to index it into.
  const canIndexOlder =
    Boolean(searchIndexStore) && (hasPreviousPage ?? false) && !fullyCovered;

  // The list's page and its active row.
  //
  // The pager is sized by the TOTAL, not by the rows on hand. That is the whole
  // point of paging: `search.results` holds one page (or the head's capped
  // window), so slicing it would cap the pager at that page count -- a 24k-match
  // query would offer "1/101" and the rest of the conversation would be
  // unreachable. Bounds come from `totalMatches`, which is the exact count over
  // the full intersection, and the rows are whatever the hook resolved for the
  // page. A page the hook has not resolved yet is reported as such rather than
  // as a short or empty page.
  const searchPageSlice = useMemo(
    () =>
      paginateSearchResults(
        search.results,
        searchPage,
        SEARCH_PAGE_SIZE,
        search.totalMatches
      ),
    [search.results, search.totalMatches, searchPage]
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
      // Frozen while the field runs ahead of the results. The arrows step the
      // debounced query's matches, so pressing them mid-word would walk matches
      // for a query the user has visibly left -- the "zarquan" field stepping
      // through "zarq" ghosts. The 150ms debounce re-arms stepping almost
      // immediately; dropping the press beats landing somewhere inexplicable.
      if (search.query.trim() !== search.debouncedQuery.trim()) {
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
    [
      jumpToMessage,
      matchIds,
      search.debouncedQuery,
      search.query,
      searchActiveId,
    ]
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
        // Clamped against the TOTAL, so the pager spans the whole result set
        // rather than the page currently in hand. Without this the last page
        // would read as page 0 of 1 for any query whose rows the hook has not
        // loaded yet.
        const size = Math.max(1, SEARCH_PAGE_SIZE);
        const reachablePages = Math.max(
          1,
          Math.ceil(search.totalMatches / size)
        );
        return Math.min(Math.max(page + delta, 0), reachablePages - 1);
      });
      setSearchListIndex(0);
    },
    [search.totalMatches]
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
    setJumpError(null);
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
    setJumpError(null);
    setSearchOpen(true);
  }, []);

  // One setter feeds both views, so a query typed in the bar is the same query
  // the list ranks. A new query always returns to the first page.
  const handleSearchQueryChange = useCallback(
    (query: string) => {
      search.setQuery(query);
      setSearchPage(0);
      setSearchListIndex(0);
      setJumpError(null);
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
    // Urgent decrypts, and a history-read token: this is a person asking for
    // more images, so it must not queue behind a search backfill's decrypts or
    // spend the rate-limit budget the walk is already using.
    const { added } = await loadOlderMessages();
    if (added.length > 0) {
      requestDecryptMessages(added, { urgent: true });
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
    const index = transcriptIndexOfMessageId.get(anchorId);
    if (index === undefined) {
      return;
    }
    requestAnimationFrame(() => {
      rowVirtualizer.scrollToIndex(index, { align: "center" });
    });
  }, [mediaViewerKey, transcriptIndexOfMessageId, rowVirtualizer]);

  // Scroll to the end of whatever is currently loaded, and claim the viewport is
  // pinned so followOnAppend resumes tracking.
  //
  // Split out from the tail read so the two states are not conflated. "Pinned" is
  // a claim that the user is looking at the newest message, and after a failed
  // tail read that is false -- claiming it anyway would stop new messages from
  // being followed and clear a badge that was telling the truth.
  const scrollToLoadedEnd = useCallback(() => {
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

  // Put the transcript back on the newest messages when a jump left it anchored
  // mid-history. Resolves false when the read failed.
  const returnToTail = useCallback(async (): Promise<boolean> => {
    if (!needsTailReturn({ hasNextPage, inFlight: tailReturnRef.current })) {
      return true;
    }
    tailReturnRef.current = true;
    // A token, because this is a hundred rows of history through the same
    // endpoint the search backfill is spending. Without it the walk's 500-row
    // pages can throttle the very read the user asked for, and the fallback is
    // the broken behaviour.
    const token = historyReads.acquire();
    // And it supersedes any jump still landing: the user asked for the bottom,
    // so a jump settling a moment later must not yank them back out of it.
    jumpEpochRef.current += 1;
    jumpAbortRef.current?.abort();
    jumpInFlightRef.current = false;
    jumpActivityRef.current = null;
    setJumpActivity(null);
    setJumpLoading(false);
    setJumpTextPending(false);
    try {
      // What the transcript holds now, so a message that arrives while this read
      // is in flight is carried across rather than dropped. Same race the
      // anchored jump has, and the same helper settles it.
      const issuedIds = new Set(readFlat().map((message) => message.id));
      const tail = await fetchMessages(
        conversationId,
        { kind: "older" },
        HISTORY_PAGE_SIZE
      );
      queryClient.setQueryData<MessagesInfiniteData>(
        ["messages", conversationId],
        (old) =>
          old
            ? {
                pageParams: [NEWEST_PAGE],
                pages: [
                  reconcileAnchoredWindow({
                    currentPages: old.pages,
                    fetched: tail,
                    issuedIds,
                  }),
                ],
              }
            : old
      );
      return true;
    } catch {
      // A failed read leaves the user in the window they are in, which is
      // degraded but coherent. The newer-direction loader can still grow them
      // forward, and the badge keeps telling them there is something to scroll
      // to -- which there is.
      return false;
    } finally {
      historyReads.release(token);
      tailReturnRef.current = false;
    }
  }, [conversationId, hasNextPage, historyReads, queryClient, readFlat]);

  // "Scroll to latest". Returns the transcript to the newest messages first when a
  // jump left it anchored mid-history, because scrolling to the end of an
  // anchored window is not the bottom of the conversation -- it is the bottom of
  // the page, which is the whole bug.
  //
  // Only the landed case marks the viewport pinned and clears the badge. A failed
  // read leaves the user where they were with the badge still telling the truth,
  // which is better than a transcript that claims to be at the newest message and
  // silently stops following new ones.
  const jumpToBottom = useCallback(() => {
    void (async () => {
      if (await returnToTail()) {
        scrollToLoadedEnd();
        return;
      }
      // The tail read failed. Scroll to the end of the window we are in so the
      // press still visibly did something, but do NOT claim the user is at the
      // newest message: they are not, and saying so would stop followOnAppend
      // and clear a badge that was accurate.
      const el = scrollRef.current;
      rowVirtualizer.scrollToEnd({
        behavior: el && el.scrollTop < el.clientHeight ? "smooth" : "auto",
      });
    })();
  }, [returnToTail, rowVirtualizer, scrollToLoadedEnd]);

  // Mark the conversation read when it opens and when the peer sends while
  // the thread is open (debounced so burst sends only fire one request).
  //
  // Not for somebody who has left. Opening a den you were removed from used to
  // fire a read receipt and a delivered receipt into a conversation the server
  // refuses both of, so every former member who reopened an old den filled the
  // console with two 403s for an acknowledgement nobody can receive. The viewer
  // already cannot post here, which is the whole of what those receipts report.
  const myUserId = user?.id;
  const scheduleRead = useCallback(() => {
    if (leftDen) {
      return;
    }
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
  }, [conversationId, myUserId, queryClient, leftDen]);

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
        | "keys.rotated"
        | "den.membership.changed";
      deliveredAt?: string;
      membershipAction?: string;
      membershipSeq?: number;
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
      if (event.kind === "den.membership.changed") {
        // A den's roster moved under us. The detail is the only place a roster
        // and a wrap row live, so re-read it and let everything downstream fall
        // out of the new snapshot: the key signature changes when my wraps or a
        // member's identity key change (clearing the decryptor's cached roots
        // and re-queueing payloads), and the composer's send path re-runs
        // `ensureConversationKeys`, which is what refuses an epoch a departed
        // member still holds.
        //
        // Deliberately ONLY the detail. Not the transcript and not the mount:
        // the messages in this conversation did not change, the roster around
        // them did. Invalidation here would drop scroll position and destroy an
        // in-flight draft, which is the exact cost the event was supposed to
        // avoid paying.
        //
        // The actor's own tab reaches here too, and pays one refetch. Gating on
        // `event.userId !== myUserId` would save it, but the actor's client has
        // already refetched by a different path (the mutation's own
        // invalidation), so the second read is redundant rather than wrong, and
        // the alternative is a rule that silently stops working when somebody
        // mutates the roster from a second device.
        //
        // The counter decides whether the refetch is owed at all. A duplicate
        // delivery (or an announcement that overtook a newer one on the wire) is
        // dropped here for free, and a value that could not be read is applied
        // exactly as this always applied an announcement - which is the point:
        // the refetch is the fallback, not the mechanism. The counter also tells
        // the two apart that used to be indistinguishable, a fresh change and a
        // lost one: a gap means this tab missed at least one change and the
        // single refetch it triggers is the whole remedy, because a client cannot
        // ask "which change did I miss", only "give me the roster again".
        const plan = applyMembershipSeq(
          event.conversationId,
          event.membershipSeq
        );
        if (!plan.refetchDetail) {
          return;
        }
        if (plan.kind === "gap") {
          // Logged rather than surfaced: from the user's side this is a background
          // refetch of data that is already on its way, and a toast for a
          // self-healed gap would train people to ignore the one that is not.
          console.warn(
            `Den roster gap on ${event.conversationId}: at ${plan.appliedSeq}, so at least one announcement was lost`
          );
        }
        void queryClient.invalidateQueries({
          queryKey: ["message-conversation", conversationId],
        });
        // The membership log as well as the roster. Every action this frame can
        // report - a join, a leave, a removal, a promotion, a demotion, a hand-over
        // - writes exactly one line into the transcript, so the line and the roster
        // move together or the transcript contradicts itself. Without this the log
        // only caught up on a reload, which made it read as history rather than as
        // something that had just happened.
        //
        // Cheap, and unlike the transcript invalidation it costs no scroll
        // position: the log is folded into the transcript by a merge, so re-reading
        // it re-runs that merge rather than rebuilding the page list.
        void queryClient.invalidateQueries({
          queryKey: ["den-events", conversationId],
        });
        // And the details panel's own reads: the roster, the den's own detail and the
        // banned list, all keyed under this prefix (`DEN_QUERY_PREFIX` in
        // `den-panel.tsx`).
        //
        // Without this the panel only ever moved for the tab that made the change,
        // because its `refresh()` runs from its own mutation handlers and nothing else
        // subscribed it to the roster. So somebody else joining, leaving, being removed
        // or promoted left the members list on screen stale until a manual reload - the
        // panel was the one place in the den that was not live, while the transcript
        // beside it was.
        //
        // Inline rather than imported from the panel, matching how the two keys above
        // are written. Same reason both are invalidated from here: this handler is the
        // single place that already knows a membership frame arrived, and a second
        // subscriber would be a second stream connection to the same endpoint.
        void queryClient.invalidateQueries({
          queryKey: ["message-den", conversationId],
        });
        return;
      }
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
            const nextPages = foldMessageIntoPages(old.pages, message);
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
            const nextPages = updateMessageInPages(
              old.pages,
              toCachedMessage(message)
            );
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

  // Whether the loaded roster says this reader has left this den.
  //
  // This is the reload half of the removal story. The live `membership-ended`
  // frame only reaches a tab that was already open when the removal happened, and
  // a fresh page load gets a 403 on stream connect instead - no frame, no toast,
  // and without this a composer that offers to send messages the server will
  // refuse. Read off the detail the transcript already fetched, so there is no
  // second request to keep in step with it.
  //
  // `conversationId` is a dependency as well as `leftDen`: the reset effect above
  // clears the notice when the reader switches conversations, and without the id
  useEffect(() => {
    if (leftDen) {
      setAccessEndedNotice((state) => ({ ...state, accessEnded: true }));
      // The popup too, so a tab reloaded after a removal says the same thing a tab
      // that was open when it happened does. The live path routes here through
      // `consumeSelfLeave`; this one has no marker to consult, because a reload is
      // not a leave anybody pressed a button for - which is exactly the case this
      // dialog is for.
      setRemovedNotice(true);
    }
  }, [conversationId, leftDen]);

  useMessagesRealtime(
    conversationId,
    handleEvent,
    // A den somebody left is read-only, and there is nothing for a stream to
    // deliver: the server refuses the connect with a 403, and every message in the
    // channel is encrypted under an epoch they hold no wrap for. Opening one anyway
    // would be a reconnect ladder aimed at a door that does not open.
    Boolean(user) && !leftDen,
    // Catch up on messages published while the stream was down (mobile
    // network drops). The in-flight guard stops a reconnect from stacking a
    // refetch on top of one already running (overlapping responses can land
    // out of order and leave a stale page on screen). A real reconnect
    // reconciles regardless of cache age: the stream has no replay cursor, so
    // a gap may exist even if data was written moments ago; only the initial
    // connect leans on the mount fetch and skips on recently written data.
    //
    // A reconnect re-reads the conversation DETAIL too, which the transcript
    // rules above say nothing about. This is the path that has to cover a
    // membership change missed while the socket was down: without it a client
    // that reconnected mid-removal keeps a roster naming somebody who is out,
    // and the send path has only the watermark to notice.
    useCallback(
      (isReconnect: boolean) => {
        const state = queryClient.getQueryState(["messages", conversationId]);
        for (const queryKey of catchUpKeys({
          conversationId,
          dataUpdatedAt: state?.dataUpdatedAt ?? 0,
          isFetching: state?.fetchStatus === "fetching",
          isReconnect,
          now: Date.now(),
        })) {
          void queryClient.invalidateQueries({ queryKey });
        }
      },
      [conversationId, queryClient]
    ),
    // The server found this member is no longer inside and closed the stream.
    // Reported once per conversation: a remount re-arms it, which is correct,
    // because access can come back (a rejoin through a fresh invite code).
    useCallback(
      (endedConversationId: string) => {
        if (endedConversationId !== conversationId) {
          return;
        }
        setAccessEndedNotice((state) => ({ ...state, accessEnded: true }));
        // Both endings get a centered dialog and nothing else. A removal used to
        // fire a destructive toast while the composer carried a persistent line, so
        // the same sentence appeared twice at once and the reader still had to work
        // out why the input was dead. `consumeSelfLeave` is single-use, so a genuine
        // removal can never be mistaken for the reader's own exit - the two share a
        // title and differ only in what they say survived.
        if (consumeSelfLeave(conversationId)) {
          setSelfLeftNotice(true);
          return;
        }
        setRemovedNotice(true);
      },
      [conversationId]
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

  // Pressing the peer's name and picture toggles the details pane on a wide screen,
  // and opens the sheet below `lg`.
  //
  // A toggle is what this control is shaped like. It sits at the top of the thread,
  // it is the only way to bring the pane back once it is folded, and the pane is the
  // thing it belongs to -- so the row that shows the peer is also the row that shows
  // and hides their card. It was a link to the profile before that, which duplicated
  // the pane's own "View profile" row and left the pane with no dedicated control.
  //
  // Below `lg` there is no pane to toggle, so the press opens the sheet: that is
  // where the profile link, mute and the shared content live, and a phone has no
  // other way in.
  const handleToggleDetails = useCallback(() => {
    if (!desktopDetails) {
      setDetailsOpen(true);
      return;
    }
    toggleDetailsRail();
  }, [desktopDetails, toggleDetailsRail]);

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

  // The member's own wallpaper and dim. Resolved here rather than inside the
  // style prop so the same two values could feed the details panel's swatch, and
  // so a null or unknown stored value lands on "no wallpaper" in one place.
  // `wallpaper` is null for a cleared key, which is the default and the plain app
  // background, and the overlay is null both when there is no wallpaper and at a
  // dim of 0. Both layers are therefore conditional: painting a transparent wash
  // over an empty background would cost a full-transcript compositing layer for
  // nothing.
  const wallpaper = resolveConversationWallpaper(
    detail.prefs.wallpaperKey,
    detail.prefs.wallpaperMediaId
  );
  const wallpaperDimOverlayValue = wallpaper
    ? wallpaperDimOverlay(detail.prefs.wallpaperDim)
    : null;

  return (
    <ConversationMediaViewerProvider value={openConversationMedia}>
      {/* The transcript and, from `lg` up, the details pane. The row is the
          OUTER element rather than a grid cell so the pane can be a sibling of
          the whole thread column: it holds the pane's own scroller, and a nested
          one would steal the wheel from the transcript. */}
      <div className="flex h-full min-h-0 flex-1">
        <div
          className="flex h-full min-h-0 min-w-0 flex-1 flex-col"
          // The member's stored chat theme, published as custom properties the
          // `.bubble-sent` recipe reads. Setting them here (rather than keying a
          // class off the theme) keeps one typed palette the single source for both
          // the swatch the user picked and the bubbles it paints.
          style={chatThemeVars(detail)}
        >
          <ThreadHeader
            conversation={detail}
            detailsRailCollapsed={detailsCollapsed}
            onBack={onBack}
            onToggleDetails={handleToggleDetails}
            onOpenSearch={openSearch}
            onToggleDetailsRail={toggleDetailsRail}
            onToggleRail={onToggleRail}
            showDetailsRail={showsDetailsRailToggle(desktopDetails)}
            peer={peer}
            peerPresence={peerPresence}
            peerTyping={peerTyping}
            privateKey={privateKey}
          />

          {searchOpen ? (
            <MessageSearchBar
              activePosition={searchActivePosition}
              // Jump in flight counts as work: the anchored read and the walk
              // behind it are the slowest requests this bar can be waiting on.
              indexing={transcriptFetching || jumpLoading}
              canIndexOlder={canIndexOlder}
              fullyCovered={fullyCovered}
              indexedCount={search.indexedTotal}
              indexFailed={coverage?.state === "failed"}
              indexingOlder={indexingOlder}
              inputRef={searchInputRef}
              jumpError={jumpError}
              listPageError={search.listPageError}
              listPageStale={search.listPageStale}
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
              resultCount={searchPageSlice.pageResults.length}
              totalResults={search.totalMatches}
              view={searchView}
            />
          ) : null}

          {/* `isolate` is load-bearing. It makes this box a stacking context, so
              the layers' negative z-index stops at this box's edge instead of
              escaping behind the ancestors' page background. Without it they
              would render underneath the whole app and vanish. */}
          <div className="relative isolate min-h-0 flex-1">
            {/* The member's wallpaper and its dim, painted behind the
                transcript. They are siblings of the scroller rather than a
                background on it: a background would be clipped and repainted by
                the scroller's own box, and the two layers have to change
                independently (a wallpaper swap must not reset the dim).
                `-z-10` puts them behind EVERY child, not just the virtualized
                rows: the empty state and the typing indicator are ordinary
                in-flow content, and a positioned sibling at z-index auto would
                paint over both of them. The dim shares the index with the
                wallpaper and comes later in tree order, so it still lands on top
                of the art. Both are aria-hidden and pointer-inert: pure paint. */}
            {wallpaper ? (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 -z-10 bg-cover bg-center"
                style={{
                  backgroundImage: `url(${wallpaper.src})`,
                }}
              />
            ) : null}
            {wallpaperDimOverlayValue ? (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 -z-10"
                style={{ backgroundColor: wallpaperDimOverlayValue }}
              />
            ) : null}
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
              {transcriptIsEmpty(transcriptItems) ? (
                <div className="flex min-h-full flex-col">
                  <div className="flex flex-1 flex-col items-center justify-center text-center">
                    <div className="px-6 py-5">
                      <p className="text-muted-foreground text-sm">
                        {/* A den has no single person to say hi to, and "Say hi to
                            them" in a room of twenty reads as a bug. Naming the
                            room is the same promise the row and the header make. */}
                        {conversationType === "DEN"
                          ? `Say hi in ${denHeadingName ?? "this den"}`
                          : `Say hi to ${peer?.displayName ?? "them"}`}
                      </p>
                      <p className="text-muted-foreground/70 mt-1 text-xs">
                        {/* The trust sentence, from one module. The old copy here
                            was "Messages here are encrypted", which is true and
                            reads as end-to-end to almost everyone - and this
                            scheme is server-recoverable, not end-to-end. The empty
                            transcript is exactly where somebody decides whether
                            to trust what they are about to type, so it is the
                            wrong place to leave the ambiguity in. */}
                        {messagesTrustNote({
                          memberCount: detail?.conversation.members.length,
                          type: conversationType,
                        })}
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
                      const item = transcriptItems[virtualItem.index];
                      if (!item) {
                        return null;
                      }
                      if (item.kind === "event") {
                        return (
                          <div
                            data-event-id={item.event.id}
                            data-index={virtualItem.index}
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
                            <DenEventRow
                              event={item.event}
                              myUserId={userId ?? ""}
                            />
                          </div>
                        );
                      }
                      const { message } = item;
                      // Grouping is a property of the message list, not of the
                      // transcript: a log line between two messages does not stop
                      // them continuing each other's group. So this reads the
                      // message's own index in `allMessages`. The lookup cannot
                      // miss - a message item only exists because it came from
                      // `allMessages` - so a miss is skipped rather than given a
                      // fabricated group.
                      const messageIndex = messageIndexById.get(message.id);
                      if (messageIndex === undefined) {
                        return null;
                      }
                      const groupMeta = getMessageGroupMeta(
                        allMessages,
                        messageIndex
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
                            conversationType={conversationType}
                            groupMeta={groupMeta}
                            highlighted={jumpTargetId === message.id}
                            historyVersion={historyVersion}
                            unreadDivider={
                              showUnreadDivider && message.id === unreadAnchorId
                            }
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

            {transcriptBusy ? (
              <div className="pointer-events-none absolute inset-x-0 top-2 z-10 flex justify-center">
                <span className="panel-3d text-muted-foreground flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {transcriptLoadingLabel}
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
                  optionsMessage.senderId === userId &&
                  !optionsMessage.deletedAt
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
            {/* The removal popup. Sits next to the self-leave dialog rather than
              above the composer, which is where it used to be drawn: a line
              above the input was the quietest place to put news that had already
              happened to somebody, and it left a dead input with no stated
              reason. The composer now carries the reason in its placeholder, so
              this only has to announce. */}
            <MessageAccessEndedDialog
              onDismiss={() => {
                setRemovedNotice(false);
              }}
              open={removedNotice}
            />
            <Dialog
              onOpenChange={(open) => !open && setSelfLeftNotice(false)}
              open={selfLeftNotice}
            >
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{ACCESS_ENDED_MESSAGE}</DialogTitle>
                  <DialogDescription>
                    {SELF_LEAVE_DESCRIPTION}
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <button
                    className="btn-3d inline-flex items-center justify-center rounded-lg px-3.5 py-2 text-sm font-medium"
                    onClick={() => setSelfLeftNotice(false)}
                    type="button"
                  >
                    {ACCESS_ENDED_DISMISS_LABEL}
                  </button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {searchView === "list" ? (
              <div className="absolute inset-0 z-20 flex min-h-0 flex-col bg-[hsl(var(--background))]">
                <MessageSearchResults
                  activeIndex={Math.max(searchListIndexClamped, 0)}
                  allMessages={allMessages}
                  indexing={transcriptFetching}
                  indexingOlder={indexingOlder}
                  listPageError={search.listPageError}
                  listPageLoading={search.listPageLoading}
                  listPageStale={search.listPageStale}
                  myUserId={userId ?? ""}
                  onJump={jumpFromList}
                  query={search.query}
                  results={searchPageSlice.pageResults}
                  totalMatches={search.totalMatches}
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
            accessEnded={accessEndedNotice.accessEnded}
            conversation={detail}
            editTarget={editTarget}
            replyTarget={replyTarget}
            onEditCancel={() => setEditTarget(null)}
            onEditSave={handleEditSave}
            onReplyCancel={() => setReplyTarget(null)}
            // Typing is the reader acknowledging what is on screen, so the rule
            // stops saying "new". Local only: it is not a claim that the history was
            // read, and the server is not told anything by a keystroke.
            onDraftInput={() => setUnreadDismissed(true)}
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

          {/* The dialog, below `lg` only. Keyed by conversation: its reader holds
            cursors, rows and counts for one conversation, and remounting on a
            switch is both cheaper and safer than resetting them -- a read in
            flight during the switch resolves against the old cursors. */}
          {placement === "sheet" ? (
            <ConversationDetailsPanel
              key={detail.conversation.id}
              detail={detail}
              onSelectedTabChange={(tab) => {
                setDetailsTabState({
                  conversationId: detail.conversation.id,
                  tab,
                });
              }}
              // A walk in flight, so the tabs can say "indexing" rather than imply
              // the list is the whole conversation.
              indexingRefs={coverage?.state === "running"}
              messages={allMessages}
              onClose={() => setDetailsOpen(false)}
              // The same jump the search results use, so a tile for a message this
              // device has not paged in lands the transcript on that message and
              // then opens the viewer on it.
              onJumpToMessage={jumpToMessage}
              onRequestDecrypts={requestLoadedDecrypts}
              peer={peer}
              presence={peerPresence}
              // The index the tabs read, and the token that says it changed. The
              // same store and the same signal search uses, rather than a second
              // subscription that would re-read on a different schedule.
              refsRefreshToken={searchIndex?.refreshToken ?? 0}
              searchIndexStore={searchIndexStore}
              selectedTab={selectedDetailsTab}
            />
          ) : null}
        </div>

        {/* The pane, from `lg` up, replacing the online friends rail. An `aside`
            and not a dialog: nothing here is modal, nothing traps focus, and
            there is no close -- it is the state of this conversation rather than
            something the user opened. The same `hidden lg:flex` pair the friends
            rail uses, so a stale media query costs an invisible pane for a frame
            rather than a layout that cannot fit. */}
        {placement === "rail" ? (
          <ConversationDetailsRail
            key={detail.conversation.id}
            detail={detail}
            onSelectedTabChange={(tab) => {
              setDetailsTabState({
                conversationId: detail.conversation.id,
                tab,
              });
            }}
            indexingRefs={coverage?.state === "running"}
            messages={allMessages}
            onJumpToMessage={jumpToMessage}
            onRequestDecrypts={requestLoadedDecrypts}
            peer={peer}
            presence={peerPresence}
            refsRefreshToken={searchIndex?.refreshToken ?? 0}
            searchIndexStore={searchIndexStore}
            selectedTab={selectedDetailsTab}
          />
        ) : null}
      </div>
    </ConversationMediaViewerProvider>
  );
}

// The chat theme's custom properties for the thread root, or undefined when the
// conversation has not resolved yet (the recipe's own fallbacks paint the app
// default until it does).
function chatThemeVars(
  detail: ConversationDetailResponse | undefined
): React.CSSProperties | undefined {
  if (!detail) {
    return undefined;
  }
  const theme = resolveConversationTheme(detail.prefs.themeKey);
  return {
    "--chat-accent-from": theme.cssVars.accentFrom,
    "--chat-accent-ring": theme.cssVars.accentRing,
    "--chat-accent-to": theme.cssVars.accentTo,
  } as React.CSSProperties;
}

interface VirtualRowProps {
  conversationId: string;
  groupMeta: MessageGroupMeta;
  highlighted: boolean;
  historyVersion: number;
  // This row is where the reader left off, so it carries the rule above it.
  unreadDivider: boolean;
  message: MessageData;
  messagesById: Map<string, MessageData>;
  myUserId: string;
  onEdit: (message: MessageData) => void;
  onReply: (message: MessageData) => void;
  onRequest: (message: MessageData | undefined) => void;
  onRetry: (message: MessageData) => void;
  peerName: string;
  // DM or DEN. A bubble's byline is a function of this and of the row's position
  // in its sender-run (see shouldShowSenderName), so the row decides and hands
  // the bubble a plain boolean rather than re-deriving the rule.
  conversationType: ConversationType;
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
  conversationType,
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
  unreadDivider,
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
  // The unread rule sits ABOVE the time divider when both apply: the reader's place
  // in the conversation is the more specific fact, and the timestamp still reads
  // correctly underneath it.
  const divider = (
    <>
      {unreadDivider ? <UnreadDivider /> : null}
      {groupMeta.showTimeDivider ? (
        <TimeDivider at={message.createdAt} />
      ) : null}
    </>
  );
  // Where this message sits in its sender-run, for the shared corner shaping.
  const position = bubblePosition(
    groupMeta.isFirstInGroup,
    groupMeta.isLastInGroup
  );
  const rounding = bubbleRoundingClasses(position, mine);
  // The byline. Decided once, here, from the conversation type and the row's
  // place in its run, and passed down as a plain boolean so the bubble never has
  // to know the rule (and so the deleted/decrypting/error variants can be held to
  // exactly the same decision).
  const showSenderName = shouldShowSenderName({
    conversationType,
    isFirstInGroup: groupMeta.isFirstInGroup,
    mine,
  });
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
              "bubble-received flex max-w-[85%] items-center gap-2 px-3.5 py-2 text-xs sm:max-w-[75%]",
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
        showSenderName={showSenderName}
        unknownSenderName={DEN_UNKNOWN_SENDER_NAME}
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
    prev.conversationType === next.conversationType &&
    prev.historyVersion === next.historyVersion &&
    prev.myUserId === next.myUserId &&
    prev.peerName === next.peerName &&
    prev.scrolling === next.scrolling &&
    prev.selected === next.selected &&
    prev.selectionActive === next.selectionActive &&
    prev.unreadDivider === next.unreadDivider &&
    prev.onEdit === next.onEdit &&
    prev.onReply === next.onReply &&
    prev.onRequest === next.onRequest &&
    prev.onRetry === next.onRetry
);

function ThreadHeader({
  conversation,
  detailsRailCollapsed,
  onBack,
  onOpenSearch,
  onToggleDetails,
  onToggleDetailsRail,
  onToggleRail,
  peer,
  peerPresence,
  peerTyping,
  privateKey,
  showDetailsRail,
}: {
  conversation: ConversationDetailResponse;
  // Desktop only, and only while the pane is the one on screen. Below `lg` the
  // details are a sheet with its own close button, so a fold control there would
  // be a second way to dismiss the same thing.
  detailsRailCollapsed: boolean;
  onBack: () => void;
  onOpenSearch: () => void;
  onToggleDetails: () => void;
  onToggleDetailsRail: () => void;
  onToggleRail: () => void;
  // Whether this viewport is one where the pane belongs, which is a question about
  // the screen rather than about the pane's current state. The distinction is the
  // whole reason this prop exists: folding resolves the placement to `none`, so
  // gating the toggle on the pane being SHOWN hid the control the moment it was used
  // and folding became a one-way trip. The way back has to outlive the thing it
  // brings back. The inverse of the online friends button below: one of the two is
  // always present from `lg` up.
  showDetailsRail: boolean;
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

  // The den half of the heading. Null for a DM, which is the overwhelmingly
  // common case, so the extra object is only built when the conversation is one.
  const denIdentity =
    conversation.conversation.type === "DEN"
      ? {
          avatarMediaId: conversation.conversation.avatarMediaId ?? null,
          // The header states the size of the den, so it counts everybody in it -
          // the viewer included, and nobody who has left. This used to count
          // `others` and then label the number "member", which made a two-person
          // den read "1 member" in the header while the details panel said "2".
          memberCount: conversation.conversation.members.filter(
            (member) => !hasDeparted(member)
          ).length,
          members: conversation.conversation.members
            .filter((member) => !hasDeparted(member))
            .map((member) => ({
              avatarUrl: member.user.avatarUrl,
              displayName: member.user.displayName,
              id: member.userId,
              role: member.role ?? null,
              username: member.user.username,
            })),
          myUserId: user?.id ?? "",
        }
      : null;
  const headerName = conversationDisplayName(
    {
      members: conversation.conversation.members.map((member) => ({
        avatarUrl: member.user.avatarUrl,
        displayName: member.user.displayName,
        id: member.userId,
        username: member.user.username,
      })),
      name: conversation.conversation.name,
      type: conversation.conversation.type,
    },
    user?.id ?? ""
  );
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

      {/* Avatar + identity is ONE control: it toggles the conversation's contact
          card (actions, shared media/posts/links) on a wide screen, and opens it as a
          sheet below `lg`.
          
          No hover wash. `pill-3d-hover` painted a grey gradient across the whole row,
          which on a header that already has a hoverable control beside it read as a
          selection rather than as affordance. What is left is the underline on the
          name and an explicit `cursor-pointer` -- buttons do not get one from
          Tailwind v4's preflight, so a control that only looks clickable would not
          say so. */}
      {/* A den's heading names the room and says how many are in it; a DM's names
          the person and says whether they are around. Both come out of the same
          helpers the list row uses, so the header and the row cannot disagree
          about what a den with no name is called. `peer` is undefined for a den by
          construction (see the resolver above), so this branch is the den's, not a
          fallback for a DM whose peer failed to resolve. */}
      <button
        aria-expanded={showDetailsRail ? !detailsRailCollapsed : undefined}
        className="group -ml-1 flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-xl py-1 pr-2 pl-1 text-left"
        onClick={onToggleDetails}
        title={`${headerName} — conversation details`}
        type="button"
      >
        <span className="relative flex shrink-0 items-center justify-center">
          {denIdentity ? (
            <DenAvatarCollage
              avatarMediaId={denIdentity.avatarMediaId}
              members={denIdentity.members}
              myUserId={denIdentity.myUserId}
              size={32}
            />
          ) : (
            <UserAvatar avatarUrl={peer?.avatarUrl ?? null} size={32} />
          )}
          {/* Presence is a property of a person. A room is not online. */}
          {peerPresence ? (
            <span
              className={cn(
                "ring-background absolute right-0 bottom-0 size-2.5 rounded-full border-2",
                peerPresence === "online" ? "bg-green-500" : "bg-amber-500"
              )}
            />
          ) : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5 text-sm font-semibold">
            <span className="min-w-0 truncate group-hover:underline">
              {headerName}
            </span>
            {peer ? (
              <UserBadge
                badge={peer.badge}
                badges={peer.badges}
                communityRoles={peer.communityMemberships}
              />
            ) : null}
          </span>
          {peerTyping ? (
            <span className="text-primary block truncate text-xs font-medium">
              typing…
            </span>
          ) : (
            <span className="text-muted-foreground block truncate text-xs">
              {denIdentity
                ? denMemberCountLabel(denIdentity.memberCount)
                : presenceLabel(peerPresence, peer?.username)}
            </span>
          )}
        </span>
      </button>

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

      {/* Persistent for as long as this viewport has room for the pane, whatever the
          pane is currently doing. The two rail controls are mutually exclusive by
          VIEWPORT rather than by state: from `lg` the pane replaces the online list,
          so its fold control appears and the friends button does not. */}
      {showDetailsRail ? (
        <button
          aria-label={
            detailsRailCollapsed ? "Show chat details" : "Hide chat details"
          }
          aria-expanded={!detailsRailCollapsed}
          className="icon-btn-3d hidden h-8 w-8 shrink-0 items-center justify-center rounded-full lg:flex"
          onClick={onToggleDetailsRail}
          title={
            detailsRailCollapsed ? "Show chat details" : "Hide chat details"
          }
          type="button"
        >
          <DetailsRailToggleIcon collapsed={detailsRailCollapsed} />
        </button>
      ) : null}

      <button
        aria-label="Online friends"
        className="icon-btn-3d flex h-8 w-8 shrink-0 items-center justify-center rounded-full lg:hidden"
        onClick={onToggleRail}
        title="Online friends"
        type="button"
      >
        <Users className="h-4 w-4" />
      </button>

      {/* Below `lg` only. On a wide screen the conversation list is right there and
          picking a thread is how you leave one; a close control beside a pinned pane
          reads as the way out of THAT pane, which is the one thing it does not do. */}
      <button
        aria-label="Close chat"
        className="icon-btn-3d flex h-8 w-8 shrink-0 items-center justify-center rounded-full lg:hidden"
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
// The rule that says the messages below it arrived after the reader last looked.
// A centered label between two hairlines, which is how every chat client draws it:
// unmistakable in a scroll, and it does not read as a message of its own the way a
// left-aligned row would.
function UnreadDivider() {
  return (
    <div className="flex items-center gap-2 pt-1 pb-2">
      <span aria-hidden className="bg-primary/40 h-px flex-1" />
      <span className="text-primary text-[10px] font-semibold tracking-wide uppercase">
        {UNREAD_DIVIDER_LABEL}
      </span>
      <span aria-hidden className="bg-primary/40 h-px flex-1" />
    </div>
  );
}

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

// A membership log line: "Ada joined the den", "Bob was removed", "Ada made
// Cara an Elder". Centered and muted like the time divider, because it is the
// same kind of thing - a fact about the room's timeline rather than something
// somebody said in it. Drawing it as a bubble would put words in a member's
// mouth, and drawing it left-aligned would make it read as a message.
//
// `myUserId` is handed in so the line can say "You" and the row can tint when the
// reader is on either end of it. Both decisions are `denEventLine` and
// `denEventIsAboutMe`, which are pure and tested on their own.
function DenEventRow({
  event,
  myUserId,
}: {
  event: DenMembershipEvent;
  myUserId: string;
}) {
  const mine = denEventIsAboutMe(event, myUserId);
  return (
    <div className="flex justify-center px-4 pt-1 pb-2">
      <span
        className={
          mine
            ? "bg-primary/10 text-foreground/80 rounded-full px-2.5 py-0.5 text-center text-[11px] font-medium"
            : "text-muted-foreground px-2.5 py-0.5 text-center text-[11px]"
        }
      >
        {denEventLine(event, myUserId)}
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
