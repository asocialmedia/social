// Decides whether opening (or staying in) search should start a history walk,
// kept pure so the policy is unit-testable without React.
//
// The walk used to be manual-only because automatically loading history meant
// fetching, decrypting, and committing in an unbounded loop that fought the
// transcript for the IndexedDB write lock. That loop is gone -- the walk
// fetches directly without growing the transcript, and commits are paced and
// serialized -- so catch-up can run itself: start when search opens on
// partially covered history, chain each yielded run into the next, and stop
// for anything the user or the device decided.

import type { BackfillState } from "./message-index-backfill";

export interface AutoWalkCoverage {
  reachedStart: boolean;
  state: BackfillState;
}

export interface ShouldAutoStartWalkInput {
  // The search session is open. Closing it stops any run rather than starting
  // one, so background work never serves a thread nobody is reading.
  searchOpen: boolean;
  // The index backend resolved. Starting before it does would silently no-op
  // and -- worse -- never retry, because nothing re-fires the effect.
  storeReady: boolean;
  // The writer instance exists. Same missed-window hazard as the store.
  writerReady: boolean;
  // Automatic indexing is enabled. There is no manual stop -- stopping comes
  // from close, hide, or teardown -- so the thread always passes true; the
  // flag exists so the policy reads completely and stays testable.
  autoIndex: boolean;
  // A run is in flight. Starting a second one would double-fetch every page
  // (concurrent runs are only shared when they share the object, and this
  // would be a new one).
  running: boolean;
  // A previous walk persisted that it reached the oldest message. Reopening
  // search on a covered conversation then costs nothing -- not even the probe
  // walk that would rediscover it in one request.
  persistedCovered: boolean | null;
  // Whether that verdict vouches for its own cursor chain. A covered flag
  // without it is a legacy row: the next run descends from the top once to
  // earn the mark, then resumes cheaply forever after. Unknown waits like the
  // coverage verdict does.
  persistedChainVerified: boolean | null;
  // The latest walk report, if any run has reported in this session.
  coverage: AutoWalkCoverage | null;
}

export function shouldAutoStartWalk(input: ShouldAutoStartWalkInput): boolean {
  const {
    autoIndex,
    coverage,
    persistedChainVerified,
    persistedCovered,
    running,
    searchOpen,
    storeReady,
    writerReady,
  } = input;
  if (!searchOpen || !storeReady || !writerReady || !autoIndex || running) {
    return false;
  }
  if (coverage?.reachedStart === true) {
    return false;
  }
  if (coverage) {
    // Only a run that yielded on its page budget chains into the next one. A
    // failed run needs a human (storage, quota, keys); a stopped one ended
    // with its session (close or hide), and the fresh session re-evaluates
    // from a cleared report rather than chaining here.
    return coverage.state === "done";
  }
  // No report yet this session. The persisted skip needs BOTH halves: a
  // covered flag whose cursor chain was verified on the way down. Either half
  // unknown means the verdict is not in yet, so wait for it; either half
  // negative starts a run, which is what earns the marks for next time.
  // Deliberately no transcript check. The transcript's "no older page" can
  // lie -- a jump replaces the window with an anchored page whose cursors say
  // nothing about the conversation -- and the transcript writer covers loaded
  // rows anyway, idempotently alongside the walk. Worst case for skipping the
  // check is one probe walk per conversation: it reaches the start at once on
  // small threads and persists the verdict, so it never repeats.
  if (persistedCovered === null || persistedChainVerified === null) {
    return false;
  }
  return !(persistedCovered === true && persistedChainVerified === true);
}
