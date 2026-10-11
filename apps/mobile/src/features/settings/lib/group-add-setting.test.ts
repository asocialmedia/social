import { describe, expect, test } from "bun:test";

import {
  GROUP_ADD_POLICIES,
  isGroupAddPolicy,
  parseGroupAddSetting,
} from "./settings-api";

// The native read of the group-add setting.
//
// The parse is the whole surface on this side, so the two things worth pinning
// are what it does with a value the server sent and what it does with one it did
// not. The second matters more than it looks: an unrecognised value must not
// render as a blank or half-set control, because a privacy screen showing nothing
// selected reads as "no restriction" when it means the opposite.

describe("parseGroupAddSetting", () => {
  test("accepts every declared policy", () => {
    for (const groupAddPolicy of GROUP_ADD_POLICIES) {
      expect(parseGroupAddSetting({ groupAddPolicy })).toEqual({
        groupAddPolicy,
      });
    }
  });

  test("falls back to the account default, not to nothing", () => {
    // The fallback is the value a freshly created account has, so a signed-out
    // read or a route that has not answered leaves the tab showing a real
    // choice rather than an empty control the reader has to interpret.
    for (const payload of [
      {},
      { groupAddPolicy: null },
      { groupAddPolicy: "followers_only" },
      { groupAddPolicy: 7 },
      { groupAddPolicy: "FOLLOWERS_ONLY" },
      null,
      undefined,
      "EVERYONE",
    ]) {
      expect(parseGroupAddSetting(payload)).toEqual({
        groupAddPolicy: "FOLLOWING_ONLY",
      });
    }
  });
});

describe("isGroupAddPolicy", () => {
  test("agrees with the declared list rather than with a second copy", () => {
    // The names have to match the server's enum. A native-only spelling would
    // save a value the route refuses, and the failure would surface as a silent
    // rollback in the tab rather than as a type error.
    expect([...GROUP_ADD_POLICIES]).toEqual([
      "EVERYONE",
      "FOLLOWING_ONLY",
      "NO_DIRECT_ADDS",
    ]);
    for (const policy of GROUP_ADD_POLICIES) {
      expect(isGroupAddPolicy(policy)).toBe(true);
    }
    expect(isGroupAddPolicy("followers_only")).toBe(false);
    expect(isGroupAddPolicy(null)).toBe(false);
  });
});
