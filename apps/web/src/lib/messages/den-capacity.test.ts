import { describe, expect, test } from "bun:test";

import { DEN_LIMITS } from "@asm/db/messages/dens";

import {
  denAddRoom,
  denCreateNeedsOthers,
  denCreateRoom,
  denIsFull,
} from "./den-capacity";

// The den ceiling as the UI sees it, and the claim that the UI honours it.
//
// The service is the authority: it re-checks the cap under its claim lock,
// because a client cannot be trusted. The UI still has to honour it, and that is
// the half nobody tests, so it is tested here.
//
// "Enforced" is a claim about the SERVICE. "The picker stops where the service
// stops" is a claim about three components and a helper, and nothing about the
// service failing would make it true or false. These are the assertions that make
// it true.

describe("denCreateRoom", () => {
  test("is the ceiling less the creator, who is already in", () => {
    // The creator is a member before the create is sent, so the roster the dialog
    // is building is the creator plus whoever gets picked.
    expect(denCreateRoom()).toBe(DEN_LIMITS.membersMax - 1);
  });

  test("is never negative", () => {
    // A picker handed a negative ceiling is a picker whose every row is dead for
    // no reason a reader can see. Clamped rather than trusted.
    expect(denCreateRoom()).toBeGreaterThanOrEqual(0);
  });
});

describe("denAddRoom", () => {
  test("is the ceiling less who is already inside", () => {
    // The room left in THIS den, which is why the add picker stops here rather
    // than at the protocol ceiling.
    expect(denAddRoom(3)).toBe(DEN_LIMITS.membersMax - 3);
  });

  test("is zero at the ceiling, so the picker offers nobody", () => {
    expect(denAddRoom(DEN_LIMITS.membersMax)).toBe(0);
  });

  test("is zero past the ceiling rather than negative", () => {
    // Past the ceiling is a state the service refuses to produce, but a stale
    // cached detail can still say it, and a negative ceiling would render as a
    // picker with every row dead and no explanation.
    expect(denAddRoom(DEN_LIMITS.membersMax + 5)).toBe(0);
  });

  test("one below the ceiling still admits exactly one person", () => {
    expect(denAddRoom(DEN_LIMITS.membersMax - 1)).toBe(1);
  });
});

describe("denIsFull", () => {
  test("is the same boundary the join service enforces", () => {
    expect(denIsFull(DEN_LIMITS.membersMax)).toBe(true);
    expect(denIsFull(DEN_LIMITS.membersMax - 1)).toBe(false);
    expect(denIsFull(DEN_LIMITS.membersMax + 1)).toBe(true);
  });

  test("is the comparison the join screen and the details panel both read", () => {
    // Both surfaces hide their join or add control at this boundary, and the
    // service refuses at it. Three places, one answer, which is what stops the
    // join screen offering a button that comes back 404.
    expect(denIsFull(0)).toBe(false);
    expect(denIsFull(DEN_LIMITS.membersMin)).toBe(false);
  });
});

describe("denCreateNeedsOthers", () => {
  test("is one other person, because the minimum counts the reader", () => {
    expect(denCreateNeedsOthers()).toBe(DEN_LIMITS.membersMin - 1);
    expect(denCreateNeedsOthers()).toBe(1);
  });

  test("never asks for fewer than one, so a den cannot be a single person", () => {
    // A den of one is a DM with extra steps, and the DM path already has a pair
    // key for that. A create with nobody else in it is refused by the service.
    expect(denCreateNeedsOthers()).toBeGreaterThanOrEqual(1);
  });
});

describe("the UI ceiling and the service ceiling are the same constant", () => {
  test("every helper moves with the constant", () => {
    // The dedup these helpers exist for, asserted as a property rather than as a
    // list of values: nothing here is a number, so raising the ceiling changes
    // all four answers at once and no caller can be left behind on the old one.
    //
    // Whether any of them has quietly started hardcoding a value is the
    // limits-consistency test's job - it scans this file for a literal that
    // could drift away from DEN_LIMITS, which is a source question and cannot be
    // asked from a value.
    const answers = [
      denCreateRoom(),
      denAddRoom(0),
      denIsFull(DEN_LIMITS.membersMax),
      denCreateNeedsOthers(),
    ];
    expect(answers[0]).toBe(DEN_LIMITS.membersMax - 1);
    expect(answers[1]).toBe(DEN_LIMITS.membersMax);
    expect(answers[2]).toBe(true);
    expect(answers[3]).toBe(DEN_LIMITS.membersMin - 1);
  });
});
