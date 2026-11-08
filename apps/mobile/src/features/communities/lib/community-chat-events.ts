// Native port of the community chat live-event handling in web's
// community-chat.tsx (SSE `change` handling) and the server replay contract
// in apps/web/src/lib/communities/chat-events.ts (per-change cache,
// `changeSequence` ordering, message-or-refetch payloads).
//
// The SSE stream delivers three event kinds: `change` (a mutation with either
// an inline message, a messageId to refetch, or a thread lifecycle notice),
// `reset` (the server discarded the cursor; reload the page), and
// `access-revoked` (handled by the screen, not here).
//
// Classifying each change into explicit actions keeps the replay path honest:
// unknown change shapes reload the page instead of being silently dropped,
// and a change that already carries its message never triggers a redundant
// page refetch (which used to storm the API on every event).
import type { CommunityChatChange, CommunityChatMessage } from "@asm/messages";

export type CommunityChatChangeAction =
  | { kind: "ignore" }
  | { kind: "merge"; message: CommunityChatMessage }
  | { kind: "refresh-message"; messageId: string }
  | { kind: "refresh-threads" }
  | { kind: "reload" };

export function classifyCommunityChatChange(
  change: CommunityChatChange
): CommunityChatChangeAction[] {
  const actions: CommunityChatChangeAction[] = [];
  if (change.kind === "thread.created" || change.kind === "thread.updated") {
    actions.push({ kind: "refresh-threads" });
  }
  if (change.message) {
    actions.push({ kind: "merge", message: change.message });
    return actions;
  }
  if (typeof change.messageId === "string" && change.messageId.length > 0) {
    actions.push({ kind: "refresh-message", messageId: change.messageId });
    return actions;
  }
  if (actions.length === 0) {
    actions.push({ kind: "reload" });
  }
  return actions;
}

// A change is stale when the screen already moved past its changeSequence;
// applying it would replay an older timeline over the current one.
export function isStaleCommunityChatChange(
  change: CommunityChatChange,
  latestChangeSequence: string
): boolean {
  try {
    return BigInt(change.changeSequence) <= BigInt(latestChangeSequence);
  } catch {
    return false;
  }
}
