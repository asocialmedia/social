import { BUBBLE_MOTION } from "@asm/messages";

import type { MessagePayload } from "./crypto";
import type { MessageData } from "./types";

export interface OutgoingMessage {
  message: MessageData;
  payload: MessagePayload;
  status: "sending" | "failed" | "acknowledged";
}

const EMPTY_OUTBOX: readonly OutgoingMessage[] = [];
const MAX_OUTBOX_MESSAGES = 32;

// Local plaintext never enters the query cache, offline history, or persistence.
export class MessageOutbox {
  readonly scope: string;
  readonly #retain: ((outbox: MessageOutbox) => void) | undefined;
  #snapshot: readonly OutgoingMessage[] = EMPTY_OUTBOX;
  readonly #acknowledged = new Set<string>();
  readonly #listeners = new Set<() => void>();
  readonly #refreshes = new Map<string, () => void>();
  #refreshTimer: ReturnType<typeof setTimeout> | undefined;
  #entranceUntil = 0;
  #refreshDeadline = 0;
  #nextRatchetIndex = 0;
  #retry: ((entry: OutgoingMessage) => Promise<void>) | undefined;

  constructor(scope: string, retain?: (outbox: MessageOutbox) => void) {
    this.scope = scope;
    this.#retain = retain;
  }

  getSnapshot = (): readonly OutgoingMessage[] => this.#snapshot;
  static getServerSnapshot = (): readonly OutgoingMessage[] => EMPTY_OUTBOX;
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  #replace(entries: readonly OutgoingMessage[]): void {
    this.#snapshot = entries;
    for (const listener of this.#listeners) {
      listener();
    }
  }

  get nextRatchetIndex(): number {
    return this.#nextRatchetIndex;
  }

  get(id: string): OutgoingMessage | undefined {
    return this.#snapshot.find((entry) => entry.message.id === id);
  }

  start(message: MessageData, payload: MessagePayload): void {
    const previous = this.get(message.id);
    if (previous && previous.status !== "failed") {
      throw new Error("This message is already being sent");
    }
    if (previous && previous.payload !== payload) {
      throw new Error("A retry must keep the original message");
    }
    const retained = this.#snapshot.filter(
      (entry) => entry.message.id !== message.id
    );
    if (retained.length >= MAX_OUTBOX_MESSAGES) {
      throw new Error("Retry your unsent messages before sending more");
    }
    this.#retain?.(this);
    this.#entranceUntil = Date.now() + BUBBLE_MOTION.outgoing.duration + 80;
    this.#replace([...retained, { message, payload, status: "sending" }]);
  }

  acknowledge(message: MessageData): OutgoingMessage | undefined {
    const entry = this.get(message.id);
    if (
      !entry ||
      entry.message.conversationId !== message.conversationId ||
      entry.message.senderId !== message.senderId
    ) {
      return undefined;
    }
    this.#nextRatchetIndex = Math.max(
      this.#nextRatchetIndex,
      message.ratchetIndex + 1
    );
    this.#acknowledged.add(message.id);
    if (this.#acknowledged.size > 128) {
      const oldest = this.#acknowledged.values().next().value;
      if (oldest !== undefined) {
        this.#acknowledged.delete(oldest);
      }
    }
    if (entry.status !== "acknowledged") {
      this.#replace(
        this.#snapshot.map((candidate) =>
          candidate === entry
            ? {
                ...entry,
                message: { ...message, createdAt: new Date(message.createdAt) },
                status: "acknowledged",
              }
            : candidate
        )
      );
    }
    return this.get(message.id);
  }

  wasAcknowledged(id: string): boolean {
    return this.#acknowledged.has(id);
  }

  fail(id: string): boolean {
    const entry = this.get(id);
    // An SSE echo proves the write committed even if its HTTP response was lost.
    if (!entry || entry.status === "acknowledged") {
      return false;
    }
    this.#replace(
      this.#snapshot.map((candidate) =>
        candidate === entry ? { ...entry, status: "failed" } : candidate
      )
    );
    return true;
  }

  retire(ids: ReadonlySet<string>): void {
    const now = Date.now();
    const retained = this.#snapshot.filter((entry) => {
      const expired =
        entry.message.expiresAt &&
        new Date(entry.message.expiresAt).getTime() <= now;
      return (
        entry.status !== "acknowledged" ||
        (!ids.has(entry.message.id) && !expired)
      );
    });
    if (retained.length !== this.#snapshot.length) {
      this.#replace(retained);
    }
  }

  setRetryHandler(
    handler: (entry: OutgoingMessage) => Promise<void>
  ): () => void {
    this.#retry = handler;
    return () => {
      if (this.#retry === handler) {
        this.#retry = undefined;
      }
    };
  }

  retry(id: string): void {
    const entry = this.get(id);
    if (entry?.status === "failed") {
      void this.#retry?.(entry);
    }
  }

  deferRefresh(key: string, refresh: () => void): void {
    this.#refreshes.set(key, refresh);
    if (this.#refreshTimer !== undefined) {
      return;
    }
    // A live send extends this batch until its spring has settled.
    this.#refreshDeadline = Date.now() + 1500;
    this.#refreshTimer = setTimeout(this.#flushRefreshes, 450);
  }

  #flushRefreshes = (): void => {
    const now = Date.now();
    const remaining = Math.min(
      this.#entranceUntil - now,
      this.#refreshDeadline - now
    );
    if (remaining > 0) {
      this.#refreshTimer = setTimeout(this.#flushRefreshes, remaining);
      return;
    }
    this.#refreshTimer = undefined;
    const refreshes = [...this.#refreshes.values()];
    this.#refreshes.clear();
    for (const run of refreshes) {
      run();
    }
  };

  cancelRefreshes(): void {
    clearTimeout(this.#refreshTimer);
    this.#refreshTimer = undefined;
    this.#refreshes.clear();
  }
}

export function mergeOutgoingMessages(
  messages: MessageData[],
  outgoing: readonly OutgoingMessage[],
  now = Date.now()
): MessageData[] {
  if (outgoing.length === 0) {
    return messages;
  }
  const ids = new Set(messages.map((message) => message.id));
  const pending = outgoing.filter(
    (entry) =>
      !ids.has(entry.message.id) &&
      (!entry.message.expiresAt ||
        new Date(entry.message.expiresAt).getTime() > now)
  );
  return [...messages, ...pending.map((entry) => entry.message)].toSorted(
    (left, right) =>
      left.createdAt.getTime() - right.createdAt.getTime() ||
      left.id.localeCompare(right.id)
  );
}

// Keep unsent payloads across conversation navigation, with bounded session memory.
const conversationOutboxes = new Map<string, MessageOutbox>();
const MAX_OUTBOX_CONVERSATIONS = 16;

export function getMessageOutbox(
  scope: string,
  conversationId: string
): MessageOutbox {
  const key = `${scope}\u0000${conversationId}`;
  const retained = conversationOutboxes.get(key);
  if (retained) {
    return retained;
  }
  return new MessageOutbox(scope, (outbox) => {
    if (conversationOutboxes.get(key) === outbox) {
      return;
    }
    if (conversationOutboxes.size >= MAX_OUTBOX_CONVERSATIONS) {
      const completed = [...conversationOutboxes].find(([, candidate]) =>
        candidate
          .getSnapshot()
          .every((entry) => entry.status === "acknowledged")
      );
      if (!completed) {
        throw new Error("Retry your unsent conversations before sending more");
      }
      conversationOutboxes.delete(completed[0]);
    }
    conversationOutboxes.set(key, outbox);
  });
}

export function clearOutboxesOutsideScope(scope: string): void {
  for (const [key, outbox] of conversationOutboxes) {
    if (outbox.scope !== scope) {
      outbox.cancelRefreshes();
      conversationOutboxes.delete(key);
    }
  }
}
