import { describe, expect, test } from "bun:test";

import {
  applyMembershipSeq,
  lastAppliedMembershipSeq,
  planMembershipSeq,
  readMembershipSeq,
} from "./membership-seq";

// The roster counter is the only sound way to notice a membership announcement
// that never arrived, and every branch of that decision is a security-relevant
// branch: an event applied twice costs a refetch, an event dropped as a duplicate
// costs a send into an epoch a removed member still holds. So the policy is
// tested as a table here, away from any React, stream or network.

// Each test gets its own conversation id. The watermark is module state on purpose
// (the send path reads it from outside a component), so the ids are what keep
// these cases independent - the same isolation the other client suites use by
// naming one fixture id per case.

describe("readMembershipSeq", () => {
  test("accepts a non-negative whole number", () => {
    expect(readMembershipSeq(0)).toBe(0);
    expect(readMembershipSeq(7)).toBe(7);
  });

  test("refuses everything that is not one", () => {
    // Every shape a hostile or broken publisher can put in the field, plus the two
    // that matter most in practice: a payload cached before the column existed
    // (`undefined`/`null`) and a server that has not shipped it yet (absent).
    for (const value of [
      undefined,
      null,
      "",
      "3",
      "3.0",
      true,
      false,
      {},
      [],
      Number.NaN,
      Number.POSITIVE_INFINITY,
      -1,
      1.5,
      // A count of mutations could not reach this in any plausible lifetime, so it
      // is a corrupt payload rather than a real counter.
      Number.MAX_SAFE_INTEGER + 2,
    ]) {
      expect(readMembershipSeq(value)).toBeNull();
    }
  });
});

describe("planMembershipSeq", () => {
  test("a value nothing has been applied against is the first one", () => {
    expect(planMembershipSeq({ lastApplied: null, seq: 4 })).toEqual({
      appliedSeq: 4,
      kind: "first",
      refetchDetail: true,
    });
  });

  test("exactly the next value is the ordinary case", () => {
    expect(planMembershipSeq({ lastApplied: 4, seq: 5 })).toEqual({
      appliedSeq: 5,
      kind: "next",
      refetchDetail: true,
    });
  });

  test("a value at or below the last applied is a duplicate and buys nothing", () => {
    // The same value twice (a retried publish, a redelivered frame) and an older
    // one (two events overtaken on the wire). Neither may pay for a refetch: the
    // newer event already paid, and re-running it would drop scroll position and
    // an in-flight draft for nothing.
    for (const seq of [0, 3, 4]) {
      expect(planMembershipSeq({ lastApplied: 4, seq })).toEqual({
        appliedSeq: null,
        kind: "duplicate",
        refetchDetail: false,
      });
    }
  });

  test("more than one ahead is a gap, and it costs exactly one refetch", () => {
    expect(planMembershipSeq({ lastApplied: 4, seq: 6 })).toEqual({
      appliedSeq: 6,
      kind: "gap",
      refetchDetail: true,
    });
  });

  test("an absent or unreadable value behaves as it always did", () => {
    // Not a refetch-skip: the client has no evidence it already applied this
    // change, so skipping would be guessing. And nothing is recorded, because
    // remembering an unreadable value would silently disable every later
    // comparison - including the duplicate check that costs nothing.
    for (const seq of [undefined, null, "7", {}, Number.NaN, -3]) {
      expect(planMembershipSeq({ lastApplied: 4, seq })).toEqual({
        appliedSeq: null,
        kind: "unsequenced",
        refetchDetail: true,
      });
    }
  });

  test("an unreadable value is not remembered as current", () => {
    // The gap the first row cannot see: recording `null` would leave the map
    // holding a value no comparison could use, so the next readable event would
    // look like a first rather than the next one it is.
    const plan = planMembershipSeq({ lastApplied: 4, seq: "nope" });
    expect(plan.appliedSeq).toBeNull();
  });
});

describe("applyMembershipSeq", () => {
  test("records forward only", () => {
    applyMembershipSeq("den-fwd", 2);
    expect(lastAppliedMembershipSeq("den-fwd")).toBe(2);
    applyMembershipSeq("den-fwd", 3);
    expect(lastAppliedMembershipSeq("den-fwd")).toBe(3);
    // A late arrival carrying an older value cannot walk it back, so the newer
    // event's effect (its refetch, its record) stands.
    applyMembershipSeq("den-fwd", 2);
    expect(lastAppliedMembershipSeq("den-fwd")).toBe(3);
    expect(applyMembershipSeq("den-fwd", 2).kind).toBe("duplicate");
  });

  test("conversations do not share a counter", () => {
    applyMembershipSeq("den-a", 9);
    applyMembershipSeq("den-b", 1);
    expect(lastAppliedMembershipSeq("den-a")).toBe(9);
    expect(lastAppliedMembershipSeq("den-b")).toBe(1);
    // An unknown conversation has applied nothing, which is what keeps the very
    // first announcement of a DM or a fresh den from reading as a gap.
    expect(lastAppliedMembershipSeq("den-never-seen")).toBeNull();
  });

  test("a gap settles after one refetch, because the refetch reports the same value", () => {
    // The loop the gap rule has to avoid: the refetch answers with the counter it
    // just read, which is the value that was already recorded, so the next decision
    // is a duplicate and costs nothing.
    expect(applyMembershipSeq("den-settle", 1).kind).toBe("first");
    expect(applyMembershipSeq("den-settle", 5).kind).toBe("gap");
    expect(applyMembershipSeq("den-settle", 5).kind).toBe("duplicate");
    expect(lastAppliedMembershipSeq("den-settle")).toBe(5);
  });

  test("two events arriving out of order do not undo each other", () => {
    applyMembershipSeq("den-order", 1);
    const newer = applyMembershipSeq("den-order", 2);
    const older = applyMembershipSeq("den-order", 1);
    expect(newer).toMatchObject({ kind: "next", refetchDetail: true });
    expect(older).toMatchObject({ kind: "duplicate", refetchDetail: false });
    expect(lastAppliedMembershipSeq("den-order")).toBe(2);
  });

  test("an unreadable value leaves the counter exactly where it was", () => {
    applyMembershipSeq("den-junk", 3);
    expect(applyMembershipSeq("den-junk", "not-a-number").kind).toBe(
      "unsequenced"
    );
    expect(lastAppliedMembershipSeq("den-junk")).toBe(3);
    // ...and the next real change is still compared against 3, so it reads as the
    // next one instead of silently re-baselining.
    expect(applyMembershipSeq("den-junk", 4).kind).toBe("next");
  });
});
