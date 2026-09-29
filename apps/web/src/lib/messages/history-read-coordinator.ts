// Who owns the conversation's history endpoint right now.
//
// The transcript and the search-index backfill read the SAME endpoint, and on a
// fresh device they are both in flight from the first keystroke: the walk is
// pulling 500-row pages every 250ms, while a search jump needs a single anchored
// read to land the user on a match. They shared one rate-limit budget and no
// protocol, so the walk's steady stream is what a jump runs into. On a fresh
// 200k index that is the difference between a jump that lands in one request and
// one that is throttled into the bounded older-page walk -- thirty unpaced pages
// against an already-tripped limiter, which reports "Couldn't load that message"
// for a target that was a single read away.
//
// The protocol is deliberately tiny, and it is about OWNERSHIP rather than
// scheduling:
//
// - A user-initiated read (a search jump, its bounded walk, the transcript's own
//   boundary fill) takes a token for its whole life, not per request. A jump that
//   spans an anchored read plus thirty walk pages is ONE logical operation, and a
//   per-request protocol would hand the endpoint back in the gap between its own
//   pages -- which is exactly the gap that refires the background walk.
// - Background work waits for the tokens to drain before it issues anything.
//   It does not cancel itself and does not report a failure: the walk is
//   resumable, so waiting is free, and stopping would strand the cursor's
//   credibility for no reason.
// - Tokens are opaque and released by identity, never by count. A superseded
//   jump still holds a token it may never release "correctly" (its teardown is
//   skipped so it cannot clear a newer jump's state), and a counter would
//   therefore leak a permanent hold; a set cannot, because releasing a token
//   twice is a no-op and releasing one that was never taken is a no-op.
//
// A ref-free implementation on purpose: the readers are event handlers and async
// loops that run before React has re-rendered anything, and reading render-scoped
// state there is precisely how two loaders end up on one cursor.

export type HistoryReadToken = number;

export interface HistoryReadCoordinator {
  // Takes a token for a user-initiated read and returns it. The caller MUST
  // release it on every exit path, including a superseded one.
  acquire: () => HistoryReadToken;
  // Drops a token. Idempotent, and safe for a token that was already released.
  release: (token: HistoryReadToken) => void;
  // Whether any user-initiated read currently holds the endpoint.
  isBusy: () => boolean;
  // Resolves when no token is held. Already-idle resolves on a microtask rather
  // than synchronously, so a caller cannot spin a loop through this.
  //
  // An aborted signal resolves it too, and the caller still has to notice the
  // abort itself: this is a pause, not a cancellation channel, and the walk
  // decides what an abandoned wait means.
  whenIdle: (signal?: AbortSignal) => Promise<void>;
  // Drops every token. For conversation switches and unmounts, where the holders
  // are gone and their teardowns will never run -- a leaked token would hold the
  // background walk off for the whole next session.
  reset: () => void;
}

export function createHistoryReadCoordinator(): HistoryReadCoordinator {
  let nextToken = 1;
  const held = new Set<HistoryReadToken>();
  const waiters = new Set<() => void>();

  function settleWaiters(): void {
    if (held.size > 0) {
      return;
    }
    // Cleared before they run: a waiter that re-waits (a walk that loops) must
    // queue a fresh one rather than resolve twice from this drain.
    const pending = [...waiters];
    waiters.clear();
    for (const resolve of pending) {
      resolve();
    }
  }

  return {
    acquire(): HistoryReadToken {
      const token = nextToken;
      nextToken += 1;
      held.add(token);
      return token;
    },

    isBusy(): boolean {
      return held.size > 0;
    },

    release(token: HistoryReadToken): void {
      if (!held.delete(token)) {
        // Already released, or never taken. Either way the hold is gone, so
        // returning here is what keeps a double release from waking a walk that
        // a NEWER token is still blocking.
        return;
      }
      settleWaiters();
    },

    reset(): void {
      held.clear();
      settleWaiters();
    },

    whenIdle(signal?: AbortSignal): Promise<void> {
      if (held.size === 0) {
        // oxlint-disable-next-line promise/avoid-new -- an already-idle resume has no library form
        return new Promise<void>((resolve) => {
          queueMicrotask(resolve);
        });
      }
      if (signal?.aborted) {
        return Promise.resolve();
      }
      // oxlint-disable-next-line promise/avoid-new -- resolves only from a release or an abort, neither of which has an async form
      return new Promise<void>((resolve) => {
        let done = false;
        const finish = () => {
          if (done) {
            return;
          }
          done = true;
          waiters.delete(finish);
          signal?.removeEventListener("abort", finish);
          resolve();
        };
        waiters.add(finish);
        signal?.addEventListener("abort", finish, { once: true });
      });
    },
  };
}
