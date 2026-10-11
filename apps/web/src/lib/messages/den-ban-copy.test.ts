import { describe, expect, test } from "bun:test";

import {
  DEN_BAN_JOIN_DESCRIPTION,
  DEN_BAN_JOIN_DISMISS,
  DEN_BAN_JOIN_TITLE,
  DEN_BAN_PICKER_REFUSAL,
  DEN_BANS_EMPTY,
  DEN_BANS_SUMMARY,
  DEN_BAN_TERM,
  denBanAddRefusal,
  denBanConfirmCopy,
  denBanRowSubtitle,
  denUnbanConfirmCopy,
} from "./den-ban-copy";

// The wording a banned member and a manager are both given, and the two decisions the
// row menu offers. Pure, so every sentence is asserted rather than eyeballed, and so
// the affordances are a decision a test can make about a target and a viewer.

describe("the ban confirmation", () => {
  test("names the person", () => {
    expect(denBanConfirmCopy("Ada").title).toBe("Ban Ada?");
    expect(denBanConfirmCopy("Ada").confirmLabel).toBe("Ban Ada");
  });

  test("falls back for a nameless row rather than rendering a gap", () => {
    for (const input of [null, undefined, "", "   "]) {
      expect(denBanConfirmCopy(input).title).toBe("Ban This person?");
    }
  });

  // The order is the whole copy: the immediate loss, the part that surprises people,
  // then the way back. A manager reading only the first sentence would still not know
  // whether they are destroying anything.
  test("says what happens now, what survives, and what reverses it", () => {
    const { description } = denBanConfirmCopy("Ada");
    expect(description).toContain("loses access to this den immediately");
    expect(description).toContain("already read stays on their device");
    expect(description).toContain("won't be able to rejoin");
    expect(description).toContain("unbans them");
  });

  // Both doors, by name. A confirmation that only said "rejoin" would leave a manager
  // believing a shared invite link still works for this person.
  test("names both ways back in, because there are two", () => {
    const { description } = denBanConfirmCopy("Ada");
    expect(description).toContain("invite link");
    expect(description).toContain("added back");
  });
});

describe("the unban confirmation", () => {
  test("says it does not add the person back", () => {
    // The sentence that matters. Unbanning restores eligibility, and a reader who
    // assumed otherwise would announce in the room that somebody is back in when they
    // are not.
    const { description } = denUnbanConfirmCopy("Ada");
    expect(description).toContain("can rejoin");
    expect(description).toContain("does not add them to the den on its own");
  });

  test("names the person and falls back like the ban copy does", () => {
    expect(denUnbanConfirmCopy("Ada").title).toBe("Unban Ada?");
    expect(denUnbanConfirmCopy("  ").title).toBe("Unban This person?");
  });
});

describe("a ban row's subtitle", () => {
  // Priority order, asserted rather than left to whoever writes the JSX: the reason is
  // what somebody opening the list is looking for, and the author is the fallback.
  test("a reason wins over the author", () => {
    expect(denBanRowSubtitle({ bannedByName: "Grace", reason: "spam" })).toBe(
      "spam"
    );
  });

  test("a ban with no reason still says who did it", () => {
    expect(denBanRowSubtitle({ bannedByName: "Grace", reason: null })).toBe(
      "Banned by Grace"
    );
    expect(denBanRowSubtitle({ bannedByName: "Grace", reason: "  " })).toBe(
      "Banned by Grace"
    );
  });

  // A deleted manager must not leave a row with nothing under the name at all.
  test("says something even with neither", () => {
    expect(denBanRowSubtitle({ bannedByName: null, reason: null })).toBe(
      DEN_BAN_TERM
    );
  });
});

describe("the banned section", () => {
  test("the collapsed line says what being in it means", () => {
    // Otherwise a section called "Banned" reads as a mute list, and a manager cannot
    // tell why somebody she invited is not arriving.
    expect(DEN_BANS_SUMMARY).toContain("can't rejoin");
  });

  test("the empty state is one short line", () => {
    expect(DEN_BANS_EMPTY).toBe("No banned members.");
  });
});

describe("the picker refusal", () => {
  // Second person, like GROUP_ADD_REFUSAL_COPY: the row is about the person who
  // would be added and the picker is read by the person adding.
  test("reads as a fact about the candidate, not a rule about the reader", () => {
    expect(DEN_BAN_PICKER_REFUSAL).toBe("banned from this den");
  });
});

describe("the add-members refusal", () => {
  test("names the single person when there is one", () => {
    expect(denBanAddRefusal(1)).toContain("That person is banned");
  });

  test("a batch says some rather than blaming the innocent four", () => {
    // The picker already knows which people are banned, so the server naming them is
    // redundant, and a batch of five failing because one is banned is the case where
    // listing the four innocent ones helps nobody.
    const copy = denBanAddRefusal(2);
    expect(copy).toContain("Some of those people");
    expect(copy).not.toContain("That person");
  });

  test("both variants point at the same way out", () => {
    for (const count of [1, 5]) {
      expect(denBanAddRefusal(count)).toContain("banned list");
    }
  });
});

describe("the join screen's banned state", () => {
  test("the body names who can lift it", () => {
    // A locked door with no stated remedy is the state that gets read as a bug.
    expect(DEN_BAN_JOIN_DESCRIPTION).toContain("owner or Elder");
  });

  test("the body does not offer to contact anybody", () => {
    // The reader may never have met whoever banned them. Offering to open a DM with a
    // stranger on the strength of a link they were sent is exactly what the rest of
    // this feature avoids.
    expect(DEN_BAN_JOIN_DESCRIPTION).not.toMatch(/message|contact|dm/iu);
  });

  test("the only action is a way out, because no press could change anything", () => {
    expect(DEN_BAN_JOIN_DISMISS).toBe("Back to messages");
  });

  test("the title names the denial without accusing anybody", () => {
    expect(DEN_BAN_JOIN_TITLE).toBe("You can't rejoin this den");
  });
});
