import { describe, expect, test } from "bun:test";

import {
  DEN_BAN_TERM,
  DEN_BANS_EMPTY,
  DEN_BANS_SUMMARY,
  denBanConfirmCopy,
  denBanRowSubtitle,
  denConfirmCopy,
  denUnbanConfirmCopy,
} from "./den-confirm";

describe("den ban copy", () => {
  test("a ban says what is lost, what survives, and the way back", () => {
    const copy = denBanConfirmCopy("Ada");
    expect(copy.title).toBe("Ban Ada?");
    expect(copy.confirmLabel).toBe("Ban Ada");
    expect(copy.description).toContain("loses access");
    expect(copy.description).toContain("already read stays");
    expect(copy.description).toContain("unbans them");
  });

  test("an unnamed member still reads as a person", () => {
    expect(denBanConfirmCopy("  ").title).toBe("Ban This person?");
    expect(denUnbanConfirmCopy(null).confirmLabel).toBe("Unban This person");
  });

  test("an unban restores eligibility, not membership", () => {
    const copy = denUnbanConfirmCopy("Ada");
    expect(copy.description).toContain("can rejoin");
    expect(copy.description).toContain("does not add them");
  });

  test("the ban row subtitle prefers the reason, then the author", () => {
    expect(denBanRowSubtitle({ bannedByName: "Oz", reason: "  spam  " })).toBe(
      "spam"
    );
    expect(denBanRowSubtitle({ bannedByName: "Oz", reason: null })).toBe(
      "Banned by Oz"
    );
    expect(denBanRowSubtitle({ bannedByName: null, reason: null })).toBe(
      DEN_BAN_TERM
    );
    expect(DEN_BANS_EMPTY).toBe("No banned members.");
    expect(DEN_BANS_SUMMARY).toContain("can't rejoin");
  });

  test("per-kind confirm copy names losses on every path", () => {
    expect(
      denConfirmCopy({ kind: "remove-member", memberName: "Ada" }).title
    ).toBe("Remove Ada?");
    expect(
      denConfirmCopy({ kind: "ban-member", memberName: "Ada" }).title
    ).toBe(denBanConfirmCopy("Ada").title);
    expect(
      denConfirmCopy({ kind: "unban-member", memberName: "Ada" }).title
    ).toBe(denUnbanConfirmCopy("Ada").title);
    expect(denConfirmCopy({ kind: "leave-den" }).confirmLabel).toBe(
      "Leave den"
    );
    expect(
      denConfirmCopy({ kind: "transfer-ownership", memberName: "Ada" })
        .confirmLabel
    ).toBe("Hand over to Ada");
    expect(denConfirmCopy({ kind: "delete-den" }).confirmLabel).toBe(
      "Delete den"
    );
  });
});
