import { describe, expect, test } from "bun:test";

import { DEN_LIMITS } from "@asm/db/messages/dens";

import type { DenInvitePreviewResponse } from "./client";
import {
  DEN_JOIN_PATH_PREFIX,
  denInvitePath,
  denInviteUrl,
  denJoinActionLabel,
  denJoinDescription,
  denJoinFailure,
  denJoinOutcome,
  denJoinTitle,
} from "./den-invite";

function preview(
  overrides: Partial<DenInvitePreviewResponse> = {}
): DenInvitePreviewResponse {
  return {
    den: { id: "den-1", memberCount: 7, name: "Study group" },
    isMember: false,
    ...overrides,
  };
}

describe("denInvitePath", () => {
  test("builds the join screen's path", () => {
    expect(denInvitePath("abc234")).toBe(`${DEN_JOIN_PATH_PREFIX}/abc234`);
  });

  test("the prefix is a route that actually exists", async () => {
    // The copy button hands this path to another person as a URL, so a prefix that
    // does not match the app's route directory is not a stale constant, it is a
    // dead link in every chat somebody pastes it into. Checked against the file
    // rather than against another constant, because another constant would drift
    // in exactly the same way.
    const route = Bun.file(
      new URL(
        `../../app/(main)${DEN_JOIN_PATH_PREFIX}/[code]/page.tsx`,
        import.meta.url
      )
    );
    expect(await route.exists()).toBe(true);
  });

  test("normalizes the way the server normalizes before comparing", () => {
    // A code carried out of a chat or a screenshot arrives padded and shouty. The
    // alphabet is lowercase, so folding case cannot make a real code stop
    // resolving and the link keeps working.
    expect(denInvitePath("  ABC234 \n")).toBe(`${DEN_JOIN_PATH_PREFIX}/abc234`);
  });

  test("escapes a code rather than letting it shape the URL", () => {
    expect(denInvitePath("a/b?c=d")).toBe(
      `${DEN_JOIN_PATH_PREFIX}/a%2Fb%3Fc%3Dd`
    );
  });

  test("an empty code has no screen to open", () => {
    // `/messages/join/` would 404 on the server, so the answer is the index.
    expect(denInvitePath("")).toBe("/messages");
    expect(denInvitePath("   ")).toBe("/messages");
  });
});

describe("denInviteUrl", () => {
  test("is absolute, because the clipboard gets a full URL", () => {
    expect(denInviteUrl("https://asocialmedia.cc", "abc234")).toBe(
      "https://asocialmedia.cc/messages/join/abc234"
    );
  });

  test("does not double a trailing slash on the origin", () => {
    expect(denInviteUrl("https://asocialmedia.cc/", "abc234")).toBe(
      "https://asocialmedia.cc/messages/join/abc234"
    );
  });

  test("works against a local development origin", () => {
    expect(denInviteUrl("http://localhost:3000", "abc234")).toBe(
      "http://localhost:3000/messages/join/abc234"
    );
  });

  test("an empty code degrades to the messages index, not a broken join link", () => {
    expect(denInviteUrl("https://asocialmedia.cc", "")).toBe(
      "https://asocialmedia.cc/messages"
    );
  });
});

describe("denJoinOutcome", () => {
  test("a preview with no membership is a join offer", () => {
    expect(denJoinOutcome({ preview: preview() })).toEqual({
      den: { id: "den-1", memberCount: 7, name: "Study group" },
      kind: "joinable",
    });
  });

  test("a preview saying the viewer is inside is a success, not an offer", () => {
    expect(denJoinOutcome({ preview: preview({ isMember: true }) }).kind).toBe(
      "already-member"
    );
  });

  test("a missing preview is the dead end, and carries no den at all", () => {
    // The 404 the route answers for an unknown AND a rotated code must not render
    // a name and a count the client could not read.
    expect(denJoinOutcome({ preview: null })).toEqual({
      kind: "invalid",
      reason: "unknown-code",
    });
  });

  test("a den at the ceiling is full, decided from the preview alone", () => {
    // The gap this pins. The join route answers a full den with exactly the same
    // 404 as a dead code, so that a caller sweeping codes cannot tell the two
    // apart. The reader is not left guessing: the preview already reports the
    // member count, so the screen decides "full" here, from data it was given
    // either way, and never presses a button the server would refuse.
    expect(
      denJoinOutcome({
        preview: preview({
          den: {
            id: "den-1",
            memberCount: DEN_LIMITS.membersMax,
            name: "Study group",
          },
        }),
      }).kind
    ).toBe("full");
  });

  test("one below the ceiling is still joinable", () => {
    // The boundary, so an off-by-one here is a screen that refuses a join the
    // server would have accepted.
    expect(
      denJoinOutcome({
        preview: preview({
          den: {
            id: "den-1",
            memberCount: DEN_LIMITS.membersMax - 1,
            name: "Study group",
          },
        }),
      }).kind
    ).toBe("joinable");
  });

  test("a member of a full den is a member, not a locked door", () => {
    // The ceiling governs who can JOIN. It says nothing about opening what you are
    // already inside, and treating it as if it did would lock a member out of
    // their own den the moment the hundredth person arrived.
    expect(
      denJoinOutcome({
        preview: preview({
          den: {
            id: "den-1",
            memberCount: DEN_LIMITS.membersMax,
            name: "Study group",
          },
          isMember: true,
        }),
      }).kind
    ).toBe("already-member");
  });
});

describe("denJoinFailure", () => {
  test("404 means the code stopped resolving between preview and press", () => {
    expect(denJoinFailure(404)).toBe("invalid");
  });

  test("409 is the one actionable refusal", () => {
    // The route checks the identity before writing the membership row, so this is
    // the viewer with no Messages key and nothing has been created yet.
    expect(denJoinFailure(409)).toBe("needs-messages");
  });

  test("429 is its own state, not a dead end", () => {
    // Telling somebody a link is invalid because they pressed the button a few
    // times too often would be a lie they would act on.
    expect(denJoinFailure(429)).toBe("rate-limited");
  });

  test("403 is uncharacterised now that there is no block refusal to describe", () => {
    // This used to be the strongest mapping in the function: 403 meant "somebody in
    // this den has blocked you", which is terminal, and mapping it to `invalid`
    // would have sent the reader to ask for a fresh link that could not help.
    //
    // There is no block refusal any more. Blocks are DM-only, a den admits
    // regardless of them, and `joinDenByInviteCode` has no FORBIDDEN to throw, so
    // this route produces no 403 of its own. `unavailable` is the honest landing:
    // it says the server did not come back with something this screen can read,
    // which is all a 403 from outside the join service can honestly claim. `invalid`
    // would be a lie (the code is fine) and `rate-limited` would be a guess.
    expect(denJoinFailure(403)).toBe("unavailable");
    expect(denJoinFailure(403)).not.toBe("invalid");
  });

  test("anything else, including no status at all, is uncharacterised", () => {
    expect(denJoinFailure(500)).toBe("unavailable");
    expect(denJoinFailure(502)).toBe("unavailable");
    expect(denJoinFailure(null)).toBe("unavailable");
  });
});

describe("denJoin copy", () => {
  test("the invalid state never names a den", () => {
    const outcome = denJoinOutcome({ preview: null });
    expect(denJoinTitle(outcome)).toBe("This link is not valid");
    expect(denJoinDescription(outcome)).toContain("retired");
    // And it offers nothing to press, because there is nothing to press it for.
    expect(denJoinActionLabel(outcome, false)).toBeNull();
  });

  test("a joinable den names itself and offers a join", () => {
    const outcome = denJoinOutcome({ preview: preview() });
    expect(denJoinTitle(outcome)).toBe("Join this den?");
    expect(denJoinDescription(outcome)).toBe("You'll join Study group.");
    expect(denJoinActionLabel(outcome, false)).toBe("Join den");
    expect(denJoinActionLabel(outcome, true)).toBe("Joining…");
  });

  test("a member is offered the den rather than a redundant join", () => {
    const outcome = denJoinOutcome({ preview: preview({ isMember: true }) });
    expect(denJoinTitle(outcome)).toBe("You're already in this den");
    expect(denJoinActionLabel(outcome, false)).toBe("Open den");
  });

  test("a full den names the ceiling rather than a number that could be stale", () => {
    // The number comes from DEN_LIMITS on the client, the same constant the
    // server enforces with, so raising the ceiling moves both sentences at once.
    // A hardcoded 100 in this string would outlive the rule it describes.
    const outcome = denJoinOutcome({
      preview: preview({
        den: {
          id: "den-1",
          memberCount: DEN_LIMITS.membersMax,
          name: "Study group",
        },
      }),
    });
    expect(denJoinTitle(outcome)).toBe("This den is full");
    expect(denJoinDescription(outcome)).toContain(
      String(DEN_LIMITS.membersMax)
    );
    // And nothing to press, because there is nothing pressing it would achieve.
    expect(denJoinActionLabel(outcome, false)).toBeNull();
    expect(denJoinActionLabel(outcome, true)).toBeNull();
  });

  test("the 404 copy covers a den that filled up after the preview", () => {
    // The route cannot distinguish a retired code from a den that reached its
    // ceiling between the preview and the press, and deliberately answers both
    // the same way. So the sentence has to name both causes rather than assert
    // the one it cannot verify - a reader who is told "this link is not valid"
    // when the truth is "somebody filled the den" has been told something they
    // will act on and it is wrong.
    const outcome = denJoinOutcome({ preview: null });
    expect(denJoinDescription(outcome)).toContain("retired");
    expect(denJoinDescription(outcome)).toContain("filled up");
  });

  test("an unnamed den says so rather than rendering a gap", () => {
    const outcome = denJoinOutcome({
      preview: preview({ den: { id: "d", memberCount: 2, name: null } }),
    });
    expect(denJoinDescription(outcome)).toBe("This den has no name yet.");
  });
});
