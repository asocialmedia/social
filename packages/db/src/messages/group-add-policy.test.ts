import { describe, expect, test } from "bun:test";

import {
  GROUP_ADD_POLICIES,
  GROUP_ADD_REFUSAL_COPY,
  groupAddRefusal,
  isGroupAddPolicy,
} from "./dens";

// The rule, isolated from every query that feeds it.
//
// This is the decision the picker greys rows out with and the routes refuse
// rosters with, so it is tested as a function rather than through a route: the
// question "may this candidate be added" has three inputs and one answer, and a
// route test can only reach it through three round trips and a fixture.
describe("groupAddRefusal", () => {
  test("EVERYONE admits anybody, followed or not", () => {
    // The setting the user asked for first: "I should be able to add anyone, if I
    // follow them or not." The follow edge is not consulted at all here, so
    // neither direction of follow can change the answer.
    expect(groupAddRefusal("EVERYONE", true)).toBeNull();
    expect(groupAddRefusal("EVERYONE", false)).toBeNull();
  });

  test("NO_DIRECT_ADDS refuses everybody", () => {
    // Including somebody who follows the adder, which is the case that would
    // otherwise look like a way around the setting.
    expect(groupAddRefusal("NO_DIRECT_ADDS", true)).toBe("NO_DIRECT_ADDS");
    expect(groupAddRefusal("NO_DIRECT_ADDS", false)).toBe("NO_DIRECT_ADDS");
  });

  test("FOLLOWING_ONLY admits the people the candidate already follows", () => {
    expect(groupAddRefusal("FOLLOWING_ONLY", true)).toBeNull();
  });

  test("FOLLOWING_ONLY refuses somebody who does not follow the adder", () => {
    // The direction is the whole point, and the one thing a reader cannot check
    // by looking at the name of the enum. "Followers only" would have meant the
    // opposite list; this is the candidate's own following list.
    expect(groupAddRefusal("FOLLOWING_ONLY", false)).toBe("NOT_FOLLOWING_YOU");
  });

  test("the candidate's policy decides, never the adder's following list", () => {
    // Encoded rather than described: `groupAddRefusal` takes one follow fact, and
    // it is the candidate's. A caller that passed the wrong edge would have to
    // rename a parameter to compile against this.
    expect(groupAddRefusal("FOLLOWING_ONLY", true)).toBeNull();
  });
});

describe("isGroupAddPolicy", () => {
  test("accepts every declared policy and nothing else", () => {
    // Exhaustive both ways on purpose: the settings route validates with this, so
    // a value it accepts becomes a row, and a value it rejects must not.
    for (const policy of GROUP_ADD_POLICIES) {
      expect(isGroupAddPolicy(policy)).toBe(true);
    }
    expect(GROUP_ADD_POLICIES).toEqual([
      "EVERYONE",
      "FOLLOWING_ONLY",
      "NO_DIRECT_ADDS",
    ]);
  });

  test("refuses the values a column or a query string might turn up", () => {
    for (const value of [
      "",
      "everyone",
      "followers_only",
      "NONE",
      "FOLLOWERS_ONLY",
      null,
      undefined,
      1,
      {},
    ]) {
      expect(isGroupAddPolicy(value)).toBe(false);
    }
  });
});

describe("GROUP_ADD_REFUSAL_COPY", () => {
  test("has a sentence for every refusal the rule can return", () => {
    // Exhaustive by construction, so a new refusal cannot ship without the words
    // that explain it - and the words are what a greyed-out row is made of.
    const returned = new Set(
      GROUP_ADD_POLICIES.map((policy) => groupAddRefusal(policy, false)).filter(
        (refusal): refusal is NonNullable<typeof refusal> => refusal !== null
      )
    );
    for (const refusal of returned) {
      expect(GROUP_ADD_REFUSAL_COPY[refusal]).toBeTruthy();
    }
    expect(Object.keys(GROUP_ADD_REFUSAL_COPY).toSorted()).toEqual(
      [...returned].toSorted()
    );
  });

  test("never addresses the reader as you, because either side may be reading", () => {
    // The same string is rendered on a greyed-out picker row, where the reader is
    // the person doing the adding, and it is the wording a refusal carries back.
    // "You can only add people you follow" was wrong for the second of those the
    // moment the rule stopped being about the caller's follows, and would be
    // wrong again here: on the settings page the reader IS the candidate and
    // nobody is being added at all.
    for (const copy of Object.values(GROUP_ADD_REFUSAL_COPY)) {
      expect(copy).not.toMatch(/\byou\b/i);
    }
  });
});
