// Decides whether open search should start a history walk. Pure so the policy
// is unit-testable without React.

import type { BackfillState } from "./message-index-backfill";

export interface AutoWalkCoverage {
  reachedStart: boolean;
  state: BackfillState;
}

export interface ShouldAutoStartWalkInput {
  // Something is asking for history-wide results, which is what a walk builds.
  // Search does, and so does the details panel: its Media/Posts/Links tabs read
  // the same index, so on a device that has never walked this conversation they
  // would otherwise show only the decrypted slice and call it "no media".
  //
  // One predicate for both, not two walks: the `running` guard below already makes
  // a second concurrent walk impossible, and both consumers read the same store,
  // so a shared walk is strictly better than either having its own.
  wantsIndexing: boolean;
  // Starting before both resolve silently no-ops with no retry: the effect
  // never re-fires.
  storeReady: boolean;
  writerReady: boolean;
  // Always true from the thread (stop comes from close/hide/teardown); kept
  // explicit so the policy reads completely and stays testable.
  autoIndex: boolean;
  // A second run would double-fetch every page.
  running: boolean;
  // Persisted "reached oldest message". Both halves are needed to skip: the
  // flag plus a verified cursor chain. Either half unknown means the verdict
  // is not in yet.
  persistedCovered: boolean | null;
  persistedChainVerified: boolean | null;
  // Latest walk report this session, if any.
  coverage: AutoWalkCoverage | null;
}

export function shouldAutoStartWalk(input: ShouldAutoStartWalkInput): boolean {
  const {
    autoIndex,
    coverage,
    persistedChainVerified,
    persistedCovered,
    running,
    storeReady,
    wantsIndexing,
    writerReady,
  } = input;
  if (!wantsIndexing || !storeReady || !writerReady || !autoIndex || running) {
    return false;
  }
  if (coverage?.reachedStart === true) {
    return false;
  }
  if (coverage) {
    // Only a run that yielded on its page budget chains. Failed runs need a
    // human; stopped runs re-evaluate from a cleared report next session.
    return coverage.state === "done";
  }
  // No report yet: need BOTH persisted halves to skip. No transcript check:
  // a jump replaces the window with an anchored page whose cursors say nothing
  // about the conversation, and the transcript writer covers loaded rows
  // idempotently anyway. Worst case is one probe walk per conversation.
  if (persistedCovered === null || persistedChainVerified === null) {
    return false;
  }
  return !(persistedCovered === true && persistedChainVerified === true);
}
