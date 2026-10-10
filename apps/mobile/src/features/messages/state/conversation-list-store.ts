// Conversation list cache and the presence/unread polling that feeds the badges.
//
// Same shape as the transcript store: a hand-rolled cache read through
// `useSyncExternalStore`, because this app has no React Query.
//
// The list is the one surface that must always be right even when the network is
// not: it is where a user decides whether to open messages at all, so a failed
// poll leaves the previous rows in place and surfaces nothing but a quiet retry
// rather than blanking the screen.

import {
  fetchPresenceUsers,
  fetchUnreadMessageCount,
  searchMessageUsers,
} from "@/features/messages/lib/client";
import type {
  ConversationListItem,
  ConversationListResponse,
  SearchUserResult,
  PresenceUser,
} from "@/features/messages/lib/client";
import type { MessagePayload } from "@/features/messages/lib/crypto";
import { conversationPreviewText } from "@/features/messages/lib/message-preview";
import type { MessageConversationData } from "@/features/messages/lib/types";

export interface ConversationRowView extends ConversationListItem {
  avatarUrl: string | null;
  displayName: string;
  /** Carried so a decrypted payload can be framed "You: ..." without a second lookup. */
  mineUserId: string | null;
  muted: boolean;
  peerId: string | null;
  peerUsername: string | null;
  /** The decrypted last message, or undefined while it is still decrypting. */
  payload: MessagePayload | undefined;
  /** The one-line preview, derived from `payload`. */
  preview: string;
}

export interface ConversationListSnapshot {
  error: string | null;
  hasMore: boolean;
  loading: boolean;
  nextCursor: string | null;
  refreshing: boolean;
  rows: ConversationRowView[];
}

const EMPTY: ConversationListSnapshot = {
  error: null,
  hasMore: false,
  loading: true,
  nextCursor: null,
  refreshing: false,
  rows: [],
};

function toRow(
  item: ConversationListItem,
  myUserId: string | null
): ConversationRowView {
  const peer =
    item.conversation.members.find((member) => member.userId !== myUserId) ??
    item.conversation.members[0];
  return {
    ...item,
    avatarUrl: peer?.user.avatarUrl ?? null,
    displayName: peer?.user.displayName || peer?.user.username || "Unknown",
    mineUserId: myUserId,
    muted: Boolean(peer?.mutedAt),
    payload: undefined,
    peerId: peer?.userId ?? null,
    peerUsername: peer?.user.username ?? null,
    preview: "",
  };
}

export class ConversationListStore {
  #snapshot: ConversationListSnapshot = EMPTY;
  #version = 0;
  readonly #listeners = new Set<() => void>();
  #searchCache = new Map<string, SearchUserResult[]>();
  #updatedAt = 0;

  getUpdatedAt = (): number => this.#updatedAt;

  exportCiphertextResponse(): ConversationListResponse {
    const items = this.#snapshot.rows.map(
      ({ conversation, isNew, lastMessage, unreadCount }) => ({
        conversation,
        isNew,
        lastMessage,
        unreadCount,
      })
    );
    return {
      conversations: items.map((item) => item.conversation),
      hasMore: this.#snapshot.hasMore,
      items,
      nextCursor: this.#snapshot.nextCursor,
    };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  getVersion = (): number => this.#version;

  getSnapshot = (): ConversationListSnapshot => this.#snapshot;

  setSnapshot(patch: Partial<ConversationListSnapshot>): void {
    this.#snapshot = { ...this.#snapshot, ...patch };
    this.#version += 1;
    for (const listener of this.#listeners) {
      listener();
    }
  }

  replaceAll(
    response: ConversationListResponse,
    myUserId: string | null,
    fetchedAt = Date.now(),
    retainOlder = false
  ): void {
    const previous = new Map(
      this.#snapshot.rows.map((row) => [row.conversation.id, row])
    );
    const headIds = new Set(response.items.map((item) => item.conversation.id));
    const older =
      retainOlder && this.#snapshot.rows.length > response.items.length
        ? this.#snapshot.rows.filter(
            (row) =>
              row.mineUserId === myUserId && !headIds.has(row.conversation.id)
          )
        : [];
    const retainedPaging = older.length > 0;
    this.#updatedAt = fetchedAt;
    this.setSnapshot({
      error: null,
      hasMore: retainedPaging ? this.#snapshot.hasMore : response.hasMore,
      loading: false,
      nextCursor: retainedPaging
        ? this.#snapshot.nextCursor
        : response.nextCursor,
      refreshing: false,
      rows: [
        ...response.items.map((item) => {
          const next = toRow(item, myUserId);
          const old = previous.get(item.conversation.id);
          if (
            old?.mineUserId === myUserId &&
            old.lastMessage?.id === item.lastMessage?.id &&
            old.lastMessage?.ciphertext === item.lastMessage?.ciphertext &&
            old.lastMessage?.iv === item.lastMessage?.iv &&
            old.lastMessage?.deletedAt === item.lastMessage?.deletedAt &&
            old.lastMessage?.ratchetIndex === item.lastMessage?.ratchetIndex
          ) {
            return { ...next, payload: old.payload, preview: old.preview };
          }
          return next;
        }),
        ...older,
      ],
    });
  }

  /** Paging older conversations in. Dedupes by id so a refresh mid-page cannot double a row. */
  appendOlder(
    response: ConversationListResponse,
    myUserId: string | null
  ): void {
    const existing = new Set(
      this.#snapshot.rows.map((row) => row.conversation.id)
    );
    const incoming = response.items
      .filter((item) => !existing.has(item.conversation.id))
      .map((item) => toRow(item, myUserId));
    this.setSnapshot({
      error: null,
      hasMore: response.hasMore,
      nextCursor: response.nextCursor,
      rows: [...this.#snapshot.rows, ...incoming],
    });
  }

  /**
   * Folds a send that happened on another screen (or another device): bumps the
   * row's unread count and moves it to the top, which is what the server's
   * keyset ordering would produce on the next fetch anyway.
   */
  applyIncoming(conversationId: string): void {
    const rows = this.#snapshot.rows.map((row) =>
      row.conversation.id === conversationId
        ? { ...row, unreadCount: row.unreadCount + 1 }
        : row
    );
    const target = rows.find((row) => row.conversation.id === conversationId);
    const without = rows.filter(
      (row) => row.conversation.id !== conversationId
    );
    this.setSnapshot({
      rows: target ? [target, ...without] : this.#snapshot.rows,
    });
  }

  /**
   * Reconciles the decrypted payload of each row's last message. Runs after a
   * decrypt, so a row whose payload just arrived gets its preview text without a
   * refetch.
   */
  applyPreview(
    payloads: ReadonlyMap<string, MessagePayload | undefined>
  ): void {
    let changed = false;
    const rows = this.#snapshot.rows.map((row) => {
      const last = row.lastMessage;
      if (!last) {
        return row;
      }
      const payload = payloads.get(last.id);
      if (payload === undefined || row.payload === payload) {
        return row;
      }
      changed = true;
      return {
        ...row,
        payload,
        preview: conversationPreviewText({
          deleted: Boolean(last.deletedAt),
          mine: last.senderId === row.mineUserId,
          payload,
        }),
      };
    });
    // The decryptor re-reports rows it already holds on every version bump, so
    // without this the list would rebuild its snapshot on each keystroke of the
    // decryptor and re-render for nothing.
    if (changed) {
      this.setSnapshot({ rows });
    }
  }

  setMuted(conversationId: string, muted: boolean): void {
    this.setSnapshot({
      rows: this.#snapshot.rows.map((row) =>
        row.conversation.id === conversationId ? { ...row, muted } : row
      ),
    });
  }

  setTheme(conversationId: string, themeKey: string | null): void {
    this.setSnapshot({
      rows: this.#snapshot.rows.map((row) =>
        row.conversation.id === conversationId
          ? {
              ...row,
              conversation: {
                ...row.conversation,
                members: row.conversation.members.map((member) => ({
                  ...member,
                  themeKey,
                })),
              },
            }
          : row
      ),
    });
  }

  async search(
    query: string,
    options: { apiBase: string; cookie?: string; baseFetch?: typeof fetch }
  ): Promise<SearchUserResult[]> {
    const cached = this.#searchCache.get(query);
    if (cached) {
      return cached;
    }
    const users = await searchMessageUsers(query, options);
    this.#searchCache.set(query, users);
    return users;
  }

  clearSearchCache(): void {
    this.#searchCache.clear();
  }

  reset(): void {
    this.#updatedAt = 0;
    this.#snapshot = EMPTY;
    this.#searchCache.clear();
    this.#version += 1;
    for (const listener of this.#listeners) {
      listener();
    }
  }
}

export const conversationListStore = new ConversationListStore();

// ---- presence ----------------------------------------------------------------

// A refcounted heartbeat, matching web: three consumers (the nav rail, the
// conversation list, the thread header) must not produce three POSTs.
let presenceTimer: ReturnType<typeof setInterval> | null = null;
let presenceRefs = 0;

async function beat(options: {
  apiBase: string;
  cookie?: string;
  baseFetch?: typeof fetch;
}): Promise<void> {
  const { heartbeatPresence } = await import("@/features/messages/lib/client");
  await heartbeatPresence(options);
}

export function startPresenceHeartbeat(options: {
  apiBase: string;
  cookie?: string;
  baseFetch?: typeof fetch;
}): () => void {
  presenceRefs += 1;
  if (!presenceTimer) {
    void beat(options);
    presenceTimer = setInterval(() => {
      void beat(options);
    }, 30_000);
  }
  let stopped = false;
  return () => {
    if (stopped) {
      return;
    }
    stopped = true;
    presenceRefs -= 1;
    if (presenceRefs > 0 || !presenceTimer) {
      return;
    }
    clearInterval(presenceTimer);
    presenceTimer = null;
  };
}

export function loadPresence(options: {
  apiBase: string;
  cookie?: string;
  baseFetch?: typeof fetch;
}): Promise<PresenceUser[]> {
  return fetchPresenceUsers(options);
}

export function loadUnreadCount(options: {
  apiBase: string;
  cookie?: string;
  baseFetch?: typeof fetch;
}): Promise<number> {
  return fetchUnreadMessageCount(options);
}

// The peer of a conversation, for the thread header and the list row.
export function peerOf(
  conversation: MessageConversationData,
  myUserId: string | null
): MessageConversationData["members"][number] | null {
  return (
    conversation.members.find((member) => member.userId !== myUserId) ??
    conversation.members[0] ??
    null
  );
}
