// Resolves when a batch of messages has settled in the decryptor, so a backfill
// can hand the index writer rows whose payloads it can actually read.
//
// The decryptor is push-based: `request` schedules work and `subscribe` notifies
// when entries land. There is no awaitable batch API, and adding one would tie
// the backfill to WebCrypto and make it untestable. This bridges the two with the
// smallest possible surface: a lookup, an optional subscription, and a bound on
// how long to wait for rows that may never arrive.
//
// A terminal failure counts as settled. A message whose key cannot be recovered
// must not hold a page open indefinitely, and the index writer already keeps such
// rows pending for a later retry, so releasing them here loses nothing.

import type { MessageData } from "@/lib/messages/types";

export type DecryptLookup = (id: string) => unknown;

export interface WaitForDecryptsOptions {
  lookup: DecryptLookup;
  // The decryptor's subscribe. Used to react to changes instead of waiting out
  // the poll interval; omitted only where it does not exist.
  subscribe?: (listener: () => void) => () => void;
  signal?: AbortSignal;
  // Upper bound on the wait. A row that never settles is left to the writer's
  // pending set rather than stalling the walk.
  timeoutMs?: number;
}

export interface WaitForDecryptQueueSpaceOptions {
  hasSpace: () => boolean;
  signal?: AbortSignal;
  subscribe?: (listener: () => void) => () => void;
  timeoutMs?: number;
}

export interface RequestDecryptsWithBackpressureOptions<T> {
  getId: (item: T) => string;
  hasSpace: () => boolean;
  lookup: DecryptLookup;
  queueTimeoutMs?: number;
  request: (items: T[]) => T[] | null;
  signal?: AbortSignal;
  subscribe?: (listener: () => void) => () => void;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5000;
const POLL_MS = 16;

// Settled means "the decryptor has a final answer for this row". `undefined`
// (never requested, or evicted) and "pending" (still working) are both not yet.
export function isDecryptSettled(value: unknown): boolean {
  return value !== undefined && value !== "pending";
}

export function unsettledDecryptIds(
  messages: MessageData[],
  lookup: DecryptLookup
): string[] {
  const unsettled: string[] = [];
  for (const message of messages) {
    if (!isDecryptSettled(lookup(message.id))) {
      unsettled.push(message.id);
    }
  }
  return unsettled;
}

export async function waitForDecrypts(
  messages: MessageData[],
  options: WaitForDecryptsOptions
): Promise<void> {
  await waitForDecryptIds(
    messages.map(({ id }) => id),
    options
  );
}

async function waitForDecryptIds(
  ids: string[],
  options: WaitForDecryptsOptions
): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  const { lookup, signal, subscribe, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  if (signal?.aborted) {
    return;
  }
  if (ids.every((id) => isDecryptSettled(lookup(id)))) {
    // Already settled: a warm decryptor, or a re-walk over known history.
    return;
  }

  // oxlint-disable-next-line promise/avoid-new -- resolves from a timer and a subscription
  await new Promise<void>((resolve) => {
    let done = false;
    const cleanup: { unsubscribe?: () => void } = {};
    const onAbort = () => finish();

    // Declared after `finish` but initialized before anything can call it: timer
    // and interval callbacks are macrotasks, never synchronous.
    const finish = () => {
      if (done) {
        return;
      }
      done = true;
      clearInterval(interval);
      clearTimeout(timer);
      cleanup.unsubscribe?.();
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };

    const check = () => {
      if (ids.every((id) => isDecryptSettled(lookup(id)))) {
        finish();
      }
    };

    // The poll is the floor: it makes progress even with no subscription, and it
    // is cheap next to the decrypt it is waiting on. The subscription is what
    // makes the common case prompt instead of up to one poll late.
    const interval = setInterval(check, POLL_MS);
    const timer = setTimeout(finish, timeoutMs);
    signal?.addEventListener("abort", onAbort, { once: true });
    const unsubscribe = subscribe?.(check);
    if (done) {
      unsubscribe?.();
    } else {
      cleanup.unsubscribe = unsubscribe;
    }
    // Covers rows that settled between the pre-check and the timers being armed.
    check();
  });
}

export async function requestDecryptsWithBackpressure<T>(
  items: T[],
  options: RequestDecryptsWithBackpressureOptions<T>
): Promise<void> {
  const {
    getId,
    hasSpace,
    lookup,
    queueTimeoutMs = DEFAULT_TIMEOUT_MS,
    request,
    signal,
    subscribe,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;
  let remaining = items;
  // oxlint-disable no-await-in-loop -- each retry batch depends on freed capacity from the previous batch
  while (remaining.length > 0) {
    if (signal?.aborted) {
      return;
    }
    const rejected = request(remaining);
    if (rejected === null) {
      return;
    }
    const rejectedIds = new Set(rejected.map(getId));
    const acceptedIds = remaining
      .filter((item) => !rejectedIds.has(getId(item)))
      .map(getId);
    await waitForDecryptIds(acceptedIds, {
      lookup,
      signal,
      subscribe,
      timeoutMs,
    });
    if (signal?.aborted) {
      return;
    }
    remaining = rejected;
    if (remaining.length > 0) {
      const spaceAvailable = await waitForDecryptQueueSpace({
        hasSpace,
        signal,
        subscribe,
        timeoutMs: queueTimeoutMs,
      });
      if (!spaceAvailable) {
        return;
      }
    }
  }
  // oxlint-enable no-await-in-loop
}

export async function waitForDecryptQueueSpace(
  options: WaitForDecryptQueueSpaceOptions
): Promise<boolean> {
  const {
    hasSpace,
    signal,
    subscribe,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;
  if (signal?.aborted) {
    return false;
  }
  if (hasSpace()) {
    return true;
  }

  // oxlint-disable-next-line promise/avoid-new -- resolves from a queue notification, abort, or timeout
  return await new Promise<boolean>((resolve) => {
    let done = false;
    const cleanup: { unsubscribe?: () => void } = {};
    const finish = (available: boolean) => {
      if (done) {
        return;
      }
      done = true;
      cleanup.unsubscribe?.();
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve(available);
    };
    const check = () => {
      if (signal?.aborted) {
        finish(false);
      } else if (hasSpace()) {
        finish(true);
      }
    };
    const onAbort = () => finish(false);
    signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => finish(false), timeoutMs);
    const unsubscribe = subscribe?.(check);
    if (done) {
      unsubscribe?.();
    } else {
      cleanup.unsubscribe = unsubscribe;
    }
    check();
  });
}
