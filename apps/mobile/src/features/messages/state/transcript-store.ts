// Per-conversation transcript cache: the paging, the folding of realtime events,
// and the read/delivered bookkeeping. This app has no React Query, so server data
// lives in a hand-rolled store read through `useSyncExternalStore`, which is the
// pattern the feed and profile caches already use.
//
// The store is deliberately dumb about crypto: it holds ciphertext rows and knows
// nothing about keys. Decryption is the decryptor's job, and the UI reads the two
// together. That split is what lets a thread render its skeleton instantly and fill
// in plaintext as rows land, instead of blocking on a key derivation per row.

import {
  appendMessageToLastPage,
  markMessagesDeletedInPages,
  removeMessagesFromPages,
  updateMessageInPages,
} from "@/features/messages/lib/client";
import {
  HistoryThrottledError,
  isHistoryNetworkError,
  isHistoryServerError,
  isHistoryThrottled,
  isHistoryUnauthorized,
} from "@/features/messages/lib/history-throttle";
import { advanceWatermark } from "@/features/messages/lib/message-receipts";
import type { PeerWatermarks } from "@/features/messages/lib/message-receipts";
import type { MessageData, MessagePage } from "@/features/messages/lib/types";
import { firstUnreadMessageId } from "@/features/messages/lib/unread-marker";

// How many rows one page holds. Matches the server's own default so a page is a
// full screen and a bit, and a user paging history pays a request roughly once per
// two screens.
export const MESSAGE_PAGE_SIZE = 30;

export interface TranscriptSnapshot {
  /** Oldest-first, flattened across pages. */
  messages: MessageData[];
  error: string | null;
  hasMoreOlder: boolean;
  hasMoreNewer: boolean;
  loading: boolean;
  loadingOlder: boolean;
  /** True until the first page has landed at least once. */
  initialLoaded: boolean;
  myLastReadAt: string | null;
  peerWatermarks: PeerWatermarks;
  /** The peer's typing state, cleared by a timer rather than by the server. */
  peerTyping: boolean;
}

const EMPTY_SNAPSHOT: TranscriptSnapshot = {
  error: null,
  hasMoreNewer: false,
  hasMoreOlder: false,
  initialLoaded: false,
  loading: true,
  loadingOlder: false,
  messages: [],
  myLastReadAt: null,
  peerTyping: false,
  peerWatermarks: { deliveredAt: null, readAt: null },
};

interface TranscriptEntry {
  pages: MessagePage[];
  peerTypingTimer: ReturnType<typeof setTimeout> | null;
  snapshot: TranscriptSnapshot;
  version: number;
}

export class TranscriptStore {
  readonly #entries = new Map<string, TranscriptEntry>();
  readonly #listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  getVersion = (): number => {
    let total = 0;
    for (const entry of this.#entries.values()) {
      total += entry.version;
    }
    return total;
  };

  getSnapshot = (conversationId: string): TranscriptSnapshot =>
    this.#entries.get(conversationId)?.snapshot ?? EMPTY_SNAPSHOT;

  /**
   * The store is read on every render, so it must return a STABLE object while
   * nothing changed. Rebuilding the snapshot only on mutation is what keeps
   * `useSyncExternalStore` from looping.
   */
  getServerSnapshot = (conversationId: string): TranscriptSnapshot =>
    this.getSnapshot(conversationId);

  // ---- mutations -------------------------------------------------------------

  #patch(conversationId: string, patch: Partial<TranscriptSnapshot>): void {
    const entry = this.#entries.get(conversationId);
    const base = entry?.snapshot ?? EMPTY_SNAPSHOT;
    const next: TranscriptSnapshot = { ...base, ...patch };
    if (entry) {
      entry.snapshot = next;
      entry.version += 1;
    } else {
      this.#entries.set(conversationId, {
        pages: [],
        peerTypingTimer: null,
        snapshot: next,
        version: 1,
      });
    }
    for (const listener of this.#listeners) {
      listener();
    }
  }

  #flatten(conversationId: string): MessageData[] {
    const pages = this.#entries.get(conversationId)?.pages ?? [];
    return pages.flatMap((page) => page.messages);
  }

  /** Folds a freshly fetched page set in. Used for the first load and a refresh. */
  setPages(conversationId: string, page: MessagePage): void {
    const entry = this.#entries.get(conversationId);
    if (entry) {
      entry.pages = [page];
    } else {
      this.#entries.set(conversationId, {
        pages: [page],
        peerTypingTimer: null,
        snapshot: EMPTY_SNAPSHOT,
        version: 0,
      });
    }
    this.#patch(conversationId, {
      error: null,
      hasMoreNewer: Boolean(page.nextCursor),
      hasMoreOlder: Boolean(page.previousCursor),
      initialLoaded: true,
      loading: false,
      loadingOlder: false,
      messages: page.messages,
    });
  }

  /** Prepends an older page, keeping the transcript oldest-first. */
  prependOlder(conversationId: string, page: MessagePage): void {
    const entry = this.#entries.get(conversationId);
    if (!entry) {
      this.setPages(conversationId, page);
      return;
    }
    entry.pages = [...entry.pages, page];
    this.#patch(conversationId, {
      error: null,
      hasMoreOlder: Boolean(page.previousCursor),
      loadingOlder: false,
      messages: this.#flatten(conversationId),
    });
  }

  /** Appends a newer page (only reachable after an anchored jump). */
  appendNewer(conversationId: string, page: MessagePage): void {
    const entry = this.#entries.get(conversationId);
    if (!entry) {
      this.setPages(conversationId, page);
      return;
    }
    entry.pages = [...entry.pages, page];
    this.#patch(conversationId, {
      error: null,
      hasMoreNewer: Boolean(page.nextCursor),
      loadingOlder: false,
      messages: this.#flatten(conversationId),
    });
  }

  loadingOlder(conversationId: string): void {
    this.#patch(conversationId, { loadingOlder: true });
  }

  /** Marks a refresh in flight without discarding what is already readable. */
  setSnapshotLoading(conversationId: string, loading: boolean): void {
    const entry = this.#entries.get(conversationId);
    // Never flash the skeleton over a transcript that already has rows: the
    // reconcile poll fires while the user is reading.
    if (loading && entry && entry.snapshot.messages.length > 0) {
      return;
    }
    this.#patch(conversationId, { loading });
  }

  /** A failed page load must not wipe a transcript that is already readable. */
  setError(conversationId: string, error: string): void {
    this.#patch(conversationId, {
      error,
      loading: false,
      loadingOlder: false,
    });
  }

  // ---- realtime folding ------------------------------------------------------

  /**
   * Folds a `message.created`. The sender already folded the POST response, so
   * this must dedupe by id or the row appears twice.
   */
  appendMessage(conversationId: string, message: MessageData): void {
    const entry = this.#entries.get(conversationId);
    if (!entry) {
      return;
    }
    const pages = appendMessageToLastPage(entry.pages, message);
    if (!pages) {
      return;
    }
    entry.pages = pages;
    this.#patch(conversationId, { messages: this.#flatten(conversationId) });
  }

  applyMessageEdit(conversationId: string, message: MessageData): void {
    const entry = this.#entries.get(conversationId);
    if (!entry) {
      return;
    }
    const pages = updateMessageInPages(entry.pages, message);
    if (!pages) {
      return;
    }
    entry.pages = pages;
    this.#patch(conversationId, { messages: this.#flatten(conversationId) });
  }

  applyMessageDeleted(
    conversationId: string,
    messageId: string,
    deletedAt: Date
  ): void {
    const entry = this.#entries.get(conversationId);
    if (!entry) {
      return;
    }
    const pages = markMessagesDeletedInPages(
      entry.pages,
      new Set([messageId]),
      deletedAt
    );
    if (!pages) {
      return;
    }
    entry.pages = pages;
    this.#patch(conversationId, { messages: this.#flatten(conversationId) });
  }

  /** "Delete for me": the rows leave the transcript entirely. */
  removeMessages(conversationId: string, ids: ReadonlySet<string>): void {
    const entry = this.#entries.get(conversationId);
    if (!entry) {
      return;
    }
    const pages = removeMessagesFromPages(entry.pages, ids);
    if (!pages) {
      return;
    }
    entry.pages = pages;
    this.#patch(conversationId, { messages: this.#flatten(conversationId) });
  }

  setPeerTyping(conversationId: string, typing: boolean): void {
    const entry = this.#entries.get(conversationId);
    if (entry?.peerTypingTimer) {
      clearTimeout(entry.peerTypingTimer);
      entry.peerTypingTimer = null;
    }
    this.#patch(conversationId, { peerTyping: typing });
    if (!typing) {
      return;
    }
    // The server never expires a typing indicator, so the client has to. Cleared
    // early if the peer sends a message (appendMessage is not the hook for that,
    // so the thread calls setPeerTyping(false) on receipt) and by this timer.
    const timer = setTimeout(() => {
      this.setPeerTyping(conversationId, false);
    }, 6000);
    if (typeof timer === "object" && timer !== null && "unref" in timer) {
      (timer as { unref: () => void }).unref();
    }
    const current = this.#entries.get(conversationId);
    if (current) {
      current.peerTypingTimer = timer;
    }
  }

  /** A watermark update must never move backwards; `advanceWatermark` enforces it. */
  advancePeerWatermark(
    conversationId: string,
    watermark: { deliveredAt?: string | null; readAt?: string | null }
  ): void {
    const current = this.getSnapshot(conversationId);
    this.#patch(conversationId, {
      peerWatermarks: {
        deliveredAt: advanceWatermark(
          current.peerWatermarks.deliveredAt,
          toTime(watermark.deliveredAt)
        ),
        readAt: advanceWatermark(
          current.peerWatermarks.readAt,
          toTime(watermark.readAt)
        ),
      },
    });
  }

  setPeerWatermarks(conversationId: string, watermarks: PeerWatermarks): void {
    this.#patch(conversationId, { peerWatermarks: watermarks });
  }

  setMyLastReadAt(conversationId: string, value: string | null): void {
    this.#patch(conversationId, { myLastReadAt: value });
  }

  clear(conversationId: string): void {
    const entry = this.#entries.get(conversationId);
    if (entry?.peerTypingTimer) {
      clearTimeout(entry.peerTypingTimer);
    }
    this.#entries.delete(conversationId);
    for (const listener of this.#listeners) {
      listener();
    }
  }

  clearAll(): void {
    for (const entry of this.#entries.values()) {
      if (entry.peerTypingTimer) {
        clearTimeout(entry.peerTypingTimer);
      }
    }
    this.#entries.clear();
    for (const listener of this.#listeners) {
      listener();
    }
  }
}

function toTime(value: string | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

// The id of the first unread row in the loaded window, or null. The thread renders
// the divider above it.
export function unreadBoundaryId(
  snapshot: TranscriptSnapshot,
  myUserId: string
): string | null {
  return firstUnreadMessageId({
    lastReadAt: snapshot.myLastReadAt,
    messages: snapshot.messages,
    myUserId,
  });
}

// Whether a history read is worth retrying rather than surfacing. A throttled read,
// a 401 from a flapping session, a 5xx blip and a dropped fetch all heal on their
// own; a 404 does not.
export function shouldRetryHistory(error: unknown): boolean {
  return (
    isHistoryThrottled(error) ||
    isHistoryUnauthorized(error) ||
    isHistoryServerError(error) ||
    isHistoryNetworkError(error)
  );
}

export function isThrottled(error: unknown): boolean {
  return error instanceof HistoryThrottledError;
}

export const transcriptStore = new TranscriptStore();
