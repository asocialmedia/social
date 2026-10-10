// The den roster counter, and the only decision built on it.
//
// A den's membership roster decides which root-key epoch anybody may still write
// into: a member who has been removed still holds their wrap for the old epoch,
// so a client whose cached roster is behind will happily send into an epoch the
// removed member can decrypt. Nothing inside that cached snapshot reveals the
// problem - the roster reads complete, the epoch unwraps, the departed holder is
// invisible.
//
// The server moves `message_conversations.membershipSeq` by exactly one per
// committed roster change, and on nothing else, and publishes the post-increment
// value on `den.membership.changed`. Pub/sub is best-effort, so a client cannot
// assume it saw every announcement; this module is how it notices.
//
// Deliberately NOT built on `updatedAt`, which moves on every send as well: the
// hottest path in the app would then pay a conversation-detail refetch per
// message, and a timestamp cannot count changes, so two changes inside one
// millisecond compare equal and a missed announcement stays invisible. That is the
// second line of defence and it still exists (`isConversationSnapshotStale` in
// `client.ts`); this is the first.
//
// Pure where it can be and free of React, so the whole policy is unit-tested
// directly rather than inferred from a running stream - the same reason
// `realtimeFrameAction`, `shouldCatchUp` and `catchUpKeys` live outside the hook
// that uses them.

// A sequence number as it arrives from anywhere: a parsed SSE frame, a JSON
// response body, an older cached payload. Non-negative whole numbers only.
//
// Everything else is "cannot tell", and callers resolve that as today's
// behaviour rather than as a fresh roster: a negative or fractional value, a
// string, a boolean, NaN, Infinity, or a number too large to be an honest count.
// A number is the only shape this column or the wire ever produces, so anything
// else is a payload this tab did not write.
export function readMembershipSeq(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= Number.MAX_SAFE_INTEGER
    ? value
    : null;
}

export type MembershipSeqPlanKind =
  // Absent or unparseable: behave exactly as this tab behaved before the column
  // existed. Deliberately NOT a refetch-skip, because the client has no basis to
  // call the change a duplicate it has already applied.
  | "unsequenced"
  // A counter where this tab had recorded none. There is nothing to be behind, so
  // the first announcement is applied like any other.
  | "first"
  // At or below the last value applied: a duplicate delivery, or an event that
  // overtook an older one on the wire. Cheap to ignore and must be, because
  // applying it would re-run a refetch the newer event already paid for.
  | "duplicate"
  // Exactly the next value. The ordinary case.
  | "next"
  // More than one ahead: at least one announcement was lost. The response is the
  // same refetch, because a client cannot know which change it missed and can
  // only re-read the roster.
  | "gap";

export interface MembershipSeqPlan {
  // The value to record as this tab's newest known counter, or null to record
  // nothing. Null is what keeps an unreadable value from ever being remembered as
  // current, which would silently disable every later comparison.
  appliedSeq: number | null;
  kind: MembershipSeqPlanKind;
  // Whether the caller must re-read the conversation detail. False only for a
  // value this tab has already applied.
  refetchDetail: boolean;
}

// The one decision, as a function of two values and nothing else.
export function planMembershipSeq(params: {
  lastApplied: number | null;
  seq: unknown;
}): MembershipSeqPlan {
  const seq = readMembershipSeq(params.seq);
  if (seq === null) {
    // Neither the event nor the response could be read. Recording nothing keeps
    // the counter where it was, so the next readable value is compared against
    // what this tab last actually knew.
    return { appliedSeq: null, kind: "unsequenced", refetchDetail: true };
  }
  if (params.lastApplied === null) {
    return { appliedSeq: seq, kind: "first", refetchDetail: true };
  }
  if (seq <= params.lastApplied) {
    return { appliedSeq: null, kind: "duplicate", refetchDetail: false };
  }
  if (seq === params.lastApplied + 1) {
    return { appliedSeq: seq, kind: "next", refetchDetail: true };
  }
  return { appliedSeq: seq, kind: "gap", refetchDetail: true };
}

// The newest counter this tab has been told about, per conversation.
//
// Module state rather than React state on purpose: it is a fact about what the
// server has reported, not something a render depends on, and the send path reads
// it from outside any component. Keyed by conversation so a DM (whose counter
// never moves) costs nothing and a den's churn cannot affect another room.
const appliedMembershipSeqs = new Map<string, number>();

export function lastAppliedMembershipSeq(
  conversationId: string
): number | null {
  return appliedMembershipSeqs.get(conversationId) ?? null;
}

// Records a counter this tab has just been shown and answers what to do about it.
//
// One entry point for every source - a realtime announcement, a detail read, a
// list read, a create response, a send response - because they differ only in what
// the caller does with `refetchDetail`, and a second implementation would be a
// second answer to the same question.
//
// Records forward only. A value at or below the one already recorded leaves the
// map alone, which is what makes an out-of-order pair safe: the late arrival of an
// older event cannot walk the counter back and make the newer one look like a
// duplicate. It also means a gap settles - the refetch that answers a gap reports
// the same value, which reads as a duplicate and buys nothing.
export function applyMembershipSeq(
  conversationId: string,
  rawSeq: unknown
): MembershipSeqPlan {
  const plan = planMembershipSeq({
    lastApplied: lastAppliedMembershipSeq(conversationId),
    seq: rawSeq,
  });
  if (plan.appliedSeq !== null) {
    appliedMembershipSeqs.set(conversationId, plan.appliedSeq);
  }
  return plan;
}
