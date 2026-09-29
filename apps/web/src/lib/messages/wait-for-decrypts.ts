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
  // Upper bound on the wait. A row that never settles is left to the writer's
  // pending set rather than stalling the walk.
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
  if (messages.length === 0) {
    return;
  }
  const { lookup, subscribe, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  if (unsettledDecryptIds(messages, lookup).length === 0) {
    // Already settled: a warm decryptor, or a re-walk over known history.
    return;
  }

  // oxlint-disable-next-line promise/avoid-new -- resolves from a timer and a subscription
  await new Promise<void>((resolve) => {
    let done = false;

    // Declared after `finish` but initialized before anything can call it: timer
    // and interval callbacks are macrotasks, never synchronous.
    const finish = () => {
      if (done) {
        return;
      }
      done = true;
      clearInterval(interval);
      clearTimeout(timer);
      unsubscribe?.();
      resolve();
    };

    const check = () => {
      if (unsettledDecryptIds(messages, lookup).length === 0) {
        finish();
      }
    };

    // The poll is the floor: it makes progress even with no subscription, and it
    // is cheap next to the decrypt it is waiting on. The subscription is what
    // makes the common case prompt instead of up to one poll late.
    const interval = setInterval(check, POLL_MS);
    const timer = setTimeout(finish, timeoutMs);
    const unsubscribe = subscribe?.(check);
    // Covers rows that settled between the pre-check and the timers being armed.
    check();
  });
}
