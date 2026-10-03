import { describe, expect, test } from "bun:test";

import { hasDeparted, ownMembership } from "./membership";

// The predicate that decides whether a conversation is read-only for somebody.
//
// `leftAt` has three possible shapes and the third one is the whole reason this
// function exists: null for a current den member, a Date for somebody who left,
// and ABSENT on a DM row and on a detail payload that has not resolved yet.
// Comparing it to null inline makes the absent case read as "left", and a freshly
// opened den then renders itself as read-only before its roster has arrived - and
// stays that way, because the composer effect only ever sets the flag.

const LEFT_AT = new Date("2026-01-01T00:00:00.000Z");

describe("hasDeparted", () => {
  test("a current member has not left", () => {
    expect(hasDeparted({ leftAt: null, userId: "u-1" })).toBe(false);
  });

  test("a stamped member has left", () => {
    expect(hasDeparted({ leftAt: LEFT_AT, userId: "u-1" })).toBe(true);
  });

  test("a row with no leftAt has not left", () => {
    // The regression. A DM row carries no `leftAt` column, and an unresolved
    // detail carries no members at all; both mean "not known to have departed".
    // Reading either as a departure is what made every den look read-only.
    expect(hasDeparted({ userId: "u-1" })).toBe(false);
    expect(hasDeparted({ leftAt: undefined, userId: "u-1" })).toBe(false);
  });

  test("a missing row has not left", () => {
    // No row at all is the detail still loading, or a reader who is not on the
    // roster. Neither is a departure, and gating a composer on either would lock
    // out somebody who is simply in the room.
    expect(hasDeparted()).toBe(false);
    expect(hasDeparted(null)).toBe(false);
  });
});

describe("ownMembership", () => {
  const members = [
    { leftAt: null, userId: "u-1" },
    { leftAt: LEFT_AT, userId: "u-2" },
  ];

  test("finds the reader's own row", () => {
    expect(ownMembership(members, "u-2")?.leftAt).toBe(LEFT_AT);
  });

  test("is undefined for a reader who is not on the roster", () => {
    expect(ownMembership(members, "u-3")).toBeUndefined();
  });

  test("is undefined before the session has an id", () => {
    // The first render of a thread can beat the session. Matching an empty id
    // would find nobody anyway; refusing to look makes that explicit.
    expect(ownMembership(members, "")).toBeUndefined();
  });

  test("the two compose into the answer each surface asks for", () => {
    expect(hasDeparted(ownMembership(members, "u-1"))).toBe(false);
    expect(hasDeparted(ownMembership(members, "u-2"))).toBe(true);
    expect(hasDeparted(ownMembership(members, "u-3"))).toBe(false);
    expect(hasDeparted(ownMembership([], "u-1"))).toBe(false);
  });
});
