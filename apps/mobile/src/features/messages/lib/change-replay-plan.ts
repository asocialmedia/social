// What a durable change replay means for the transcript on screen.
//
// After a stream reconnect or a return to the foreground, native used to
// refetch only the newest page, so an edit, delete, hide or reaction on an
// older loaded message during the gap never reached the screen. The replay
// (from @asm/messages, the same cursor loop web runs) lists every change since
// the stored cursor; this plan keeps the latest change per message and turns
// it into store operations for the rows that are actually loaded. Rows outside
// the window need nothing: they arrive fresh when paged in.

import type { DurableMessageChange } from "@asm/messages";

export interface ChangeReplayPlan {
  // Deleted for everyone: the row stays as a tombstone.
  deleteIds: string[];
  // Edited or otherwise rewritten while still readable: re-read the row.
  refetch: { id: string; revision: number }[];
  // Access or membership changed, or the cursor expired: reload the window.
  reset: boolean;
  // Hidden for this viewer or no longer readable: the row leaves.
  removeIds: string[];
}

export function planChangeReplay(
  changes: readonly DurableMessageChange[],
  resetRequired: boolean,
  loadedIds: ReadonlySet<string>
): ChangeReplayPlan {
  const latest = new Map<string, DurableMessageChange>();
  let reset = resetRequired;
  for (const change of changes) {
    if (change.messageId === null) {
      reset = true;
      continue;
    }
    const prior = latest.get(change.messageId);
    if (!prior || change.sequence >= prior.sequence) {
      latest.set(change.messageId, change);
    }
  }
  const plan: ChangeReplayPlan = {
    deleteIds: [],
    refetch: [],
    removeIds: [],
    reset,
  };
  if (reset) {
    return plan;
  }
  // A copied sort, not toSorted: Hermes lacks the ES2023 array methods.
  // oxlint-disable-next-line unicorn/no-array-sort -- the spread is already a fresh array
  const ordered = [...latest.entries()].sort(([left], [right]) =>
    left.localeCompare(right)
  );
  for (const [id, change] of ordered) {
    if (!loadedIds.has(id)) {
      continue;
    }
    if (change.globallyDeleted) {
      plan.deleteIds.push(id);
    } else if (change.hiddenForViewer || !change.sourceAvailable) {
      plan.removeIds.push(id);
    } else if (change.kind !== "message.created") {
      const revision = change.sourceRevision ?? change.revision;
      if (revision > 0) {
        plan.refetch.push({ id, revision });
      }
    }
  }
  return plan;
}

// The replay cursor per account and conversation, for this app session. A cold
// start loads the newest window fresh, so only the gaps while the app is
// running need covering; the store matches @asm/messages' storage interface.
export function createSessionCursorStorage() {
  const values = new Map<string, string>();
  return {
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

export const replayCursorStorage = createSessionCursorStorage();
