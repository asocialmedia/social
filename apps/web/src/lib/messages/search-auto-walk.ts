// Decides whether open search should start a history walk. Pure so the policy
// is unit-testable without React.

import type { BackfillState } from "./message-index-backfill";

export interface AutoWalkCoverage {
  reachedStart: boolean;
  // Whether that run also derived shared refs for the range it walked. Reported
  // separately from `reachedStart` so a run this session is trusted only as far as
  // it actually went.
  refsReachedStart: boolean;
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
  // Persisted "reached oldest message". BOTH halves are needed to skip: the flag
  // plus a verified cursor chain. Either half unknown means the verdict is not in
  // yet.
  persistedCovered: boolean | null;
  persistedChainVerified: boolean | null;
  // Whether that verdict also covered the shared-refs index, which the details
  // pane's Media/Posts/Links tabs read.
  //
  // A third half, and the one that decides whether a conversation indexed by an
  // older build is ever repaired. Without it the pane reads an empty refs store on
  // a conversation that is fully text-indexed, skips the walk because the text IS
  // covered, and reports "no media" for a chat full of it -- forever. False is the
  // absent-means-false default, so the old verdict heals on its own the first time
  // anyone opens the conversation, and the user does nothing.
  persistedRefsCovered: boolean | null;
  // Latest walk report this session, if any.
  coverage: AutoWalkCoverage | null;
}

// A verdict half that is not in yet, whether it is explicitly null or simply
// absent from a record written before the field existed.
function isUnknown(value: boolean | null | undefined): boolean {
  return value === null || value === undefined;
}

export function shouldAutoStartWalk(input: ShouldAutoStartWalkInput): boolean {
  const {
    autoIndex,
    coverage,
    persistedChainVerified,
    persistedCovered,
    persistedRefsCovered,
    running,
    storeReady,
    wantsIndexing,
    writerReady,
  } = input;
  if (!wantsIndexing || !storeReady || !writerReady || !autoIndex || running) {
    return false;
  }
  // A run that just covered the refs index is done, whichever store it wrote to.
  // Checked before the persisted halves because a run this session is more
  // authoritative than a verdict on disk that may predate the refs index.
  if (coverage?.reachedStart === true && coverage.refsReachedStart === true) {
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
  // `undefined` counts as unknown alongside `null`, deliberately. The input is
  // typed `boolean | null`, but a verdict object read back from an older store --
  // or a caller that has not been updated -- simply does not have the field, and
  // a `=== null` check lets that through as a definite `false`. The consequence is
  // not a harmless default: a covered conversation starts a full re-walk on every
  // open, forever. An absent half has to mean "wait", which is what the other two
  // halves already mean.
  if (
    isUnknown(persistedCovered) ||
    isUnknown(persistedChainVerified) ||
    isUnknown(persistedRefsCovered)
  ) {
    return false;
  }
  return !(
    persistedCovered === true &&
    persistedChainVerified === true &&
    persistedRefsCovered === true
  );
}
