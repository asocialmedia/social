import { describe, expect, test } from "bun:test";

import {
  composerPlaceholder,
  NOT_A_MEMBER_COMPOSER_PLACEHOLDER,
  replySenderFallbackName,
  UNNAMED_DEN_COMPOSER_PLACEHOLDER,
} from "./composer-copy";

// A DM composer, which is the `isDen: false` baseline every case overrides.
function dm(
  overrides: Partial<Parameters<typeof composerPlaceholder>[0]> = {}
) {
  return composerPlaceholder({
    denName: null,
    editing: false,
    isDen: false,
    peerDisplayName: "Noah",
    writeBlockedByMembership: false,
    ...overrides,
  });
}

// A den composer, which is what the regressions are about.
function den(
  overrides: Partial<Parameters<typeof composerPlaceholder>[0]> = {}
) {
  return composerPlaceholder({
    denName: "Study group",
    editing: false,
    isDen: true,
    peerDisplayName: "Noah",
    writeBlockedByMembership: false,
    ...overrides,
  });
}

describe("composerPlaceholder", () => {
  test("a DM is addressed by its peer", () => {
    expect(dm()).toBe("Message Noah…");
  });

  test("a DM whose peer has not resolved still says something", () => {
    expect(dm({ peerDisplayName: null })).toBe("Message them…");
  });

  // The regression. The composer used to name the first member who was not the
  // reader, so a group the reader had just created offered "Message Noah…" as
  // though it were a private chat with one of its members.
  test("a named den is addressed by the name it chose", () => {
    expect(den()).toBe("Message Study group…");
  });

  test("a den is never addressed by one of its members", () => {
    expect(den({ peerDisplayName: "Noah" })).not.toContain("Noah");
  });

  test("an unnamed den never enumerates its members", () => {
    // `denDisplayName` would answer "Ada, Grace and 3 more" here, which is a
    // fine heading and a terrible thing to type at somebody.
    expect(den({ denName: null })).toBe(UNNAMED_DEN_COMPOSER_PLACEHOLDER);
    expect(den({ denName: null })).not.toContain("Noah");
  });

  test("a name of spaces is not a name", () => {
    expect(den({ denName: "   " })).toBe(UNNAMED_DEN_COMPOSER_PLACEHOLDER);
  });

  test("editing names the reader's own work", () => {
    expect(dm({ editing: true })).toBe("Edit message…");
    expect(den({ editing: true })).toBe("Edit message…");
  });

  // The reason a greyed input reading "Message Noah…" looked like a bug: a
  // removed member was told nothing at all about why they could not type.
  test("a member who lost their spot is told why the input is dead", () => {
    expect(dm({ writeBlockedByMembership: true })).toBe(
      NOT_A_MEMBER_COMPOSER_PLACEHOLDER
    );
  });

  test("membership beats every other state, edit included", () => {
    // The only state in which the reader cannot act at all, so the input is the
    // thing that has to explain itself.
    expect(dm({ editing: true, writeBlockedByMembership: true })).toBe(
      NOT_A_MEMBER_COMPOSER_PLACEHOLDER
    );
    expect(den({ editing: true, writeBlockedByMembership: true })).toBe(
      NOT_A_MEMBER_COMPOSER_PLACEHOLDER
    );
  });
});

describe("replySenderFallbackName", () => {
  test("the reader's own message is yourself", () => {
    expect(
      replySenderFallbackName({
        isDen: false,
        peerDisplayName: "Noah",
        senderIsMe: true,
      })
    ).toBe("yourself");
    expect(
      replySenderFallbackName({
        isDen: true,
        peerDisplayName: "Noah",
        senderIsMe: true,
      })
    ).toBe("yourself");
  });

  test("an unresolved sender in a den is not a named member", () => {
    // Same reason as the placeholder: a den cannot be attributed to one member.
    expect(
      replySenderFallbackName({
        isDen: true,
        peerDisplayName: "Noah",
        senderIsMe: false,
      })
    ).toBe("someone");
  });

  test("an unresolved sender in a DM is the peer", () => {
    expect(
      replySenderFallbackName({
        isDen: false,
        peerDisplayName: "Noah",
        senderIsMe: false,
      })
    ).toBe("Noah");
    expect(
      replySenderFallbackName({
        isDen: false,
        peerDisplayName: null,
        senderIsMe: false,
      })
    ).toBe("them");
  });
});
