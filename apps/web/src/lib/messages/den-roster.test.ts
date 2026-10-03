import { describe, expect, test } from "bun:test";

import { DEN_INVITE_CODE_ALPHABET, DEN_LIMITS } from "@asm/db";

import { denCandidateFailureResponse, parseMemberIds } from "./den-roster";
import type { DenCandidateFailureCode } from "./den-roster";

describe("parseMemberIds", () => {
  test("treats an absent or null field as an empty roster", () => {
    // A missing field and an explicit null both mean "no ids supplied"; the
    // routes decide what an empty roster means (create refuses it, add answers
    // 400). Collapsing them here would make one of those two paths unreachable.
    expect(parseMemberIds()).toEqual({ failure: null, memberIds: [] });
    expect(parseMemberIds(null)).toEqual({ failure: null, memberIds: [] });
  });

  test("sorts and dedupes so two clients proposing the same roster agree", () => {
    expect(parseMemberIds(["c", "a", "b", "a"])).toEqual({
      failure: null,
      memberIds: ["a", "b", "c"],
    });
  });

  test("rejects a non-array as a malformed request, not an empty roster", () => {
    const parsed = parseMemberIds("not-a-list");
    expect(parsed.memberIds).toBeNull();
    expect(parsed.failure?.code).toBe("INVALID_INPUT");
  });

  test("rejects an array holding a non-string", () => {
    // Silently coercing or dropping these would let a client believe it added
    // somebody it actually did not.
    expect(parseMemberIds(["a", 7]).failure?.code).toBe("INVALID_INPUT");
    expect(parseMemberIds(["a", null]).failure?.code).toBe("INVALID_INPUT");
    expect(parseMemberIds(["a", ""]).failure?.code).toBe("INVALID_INPUT");
  });
});

// Every refusal a proposed roster can produce, and the status each answers with.
//
// `Record<DenCandidateFailureCode, number>` rather than a list of pairs, because
// the annotation is what makes this exhaustive in BOTH directions: a code added to
// the union without a status here fails the build, and a status here for a code
// the union does not have fails it too. That is the mechanism that keeps BLOCKED
// out - naming it below would be a type error, not a decision somebody has to
// remember to revisit - and the same reason this file cannot drift from
// `FAILURE_STATUS` in `den-roster.ts` without a compiler noticing one side.
const STATUS_BY_CODE: Record<DenCandidateFailureCode, number> = {
  INVALID_INPUT: 400,
  LIMIT_REACHED: 409,
  MEMBERS_REQUIRED: 400,
  NOT_FOLLOWING_YOU: 403,
  NOT_FOUND: 404,
  NO_DIRECT_ADDS: 403,
  NO_IDENTITY: 409,
};

describe("denCandidateFailureResponse", () => {
  test("maps each code to the status the client branches on", () => {
    // 403 = "you are not allowed", stop retrying. 404 = gone or invisible, drop
    // the surface. 409 = your state already violates this, re-read instead of
    // retrying. 400 = the request itself is malformed.
    for (const code of Object.keys(
      STATUS_BY_CODE
    ) as DenCandidateFailureCode[]) {
      const response = denCandidateFailureResponse({ code, error: "x" });
      expect(response.status).toBe(STATUS_BY_CODE[code]);
    }
  });

  test("every 403 a roster can produce is a candidate's own group-add setting", () => {
    // BLOCKED used to share this status, which is exactly why a reader could not
    // tell one refusal from another. It no longer exists - a den admits regardless
    // of blocks - so what a 403 now means is narrow and checkable: the request is
    // well formed, the caller may add many people, and it is somebody named in it
    // who said no.
    //
    // A 403 that were about the CALLER's own follows would be a different thing
    // wearing the same status, and this is the assertion that keeps it from
    // quietly coming back.
    expect(
      Object.entries(STATUS_BY_CODE)
        .filter(([, status]) => status === 403)
        .map(([code]) => code)
        .toSorted()
    ).toEqual(["NOT_FOLLOWING_YOU", "NO_DIRECT_ADDS"]);
  });

  test("always carries the code so the client can distinguish the refusals", async () => {
    const response = denCandidateFailureResponse({
      code: "NO_IDENTITY",
      error: "Some of those people haven't enabled Messages yet",
    });
    expect(await response.json()).toEqual({
      code: "NO_IDENTITY",
      error: "Some of those people haven't enabled Messages yet",
    });
  });
});

describe("invite code shape", () => {
  test("is generated at the declared length from the declared alphabet", async () => {
    const { generateInviteCode } = await import("@asm/db");
    for (let index = 0; index < 200; index += 1) {
      const code = generateInviteCode();
      expect(code).toHaveLength(DEN_LIMITS.inviteCodeLength);
      for (const character of code) {
        expect(DEN_INVITE_CODE_ALPHABET).toContain(character);
      }
    }
  });

  test("does not repeat across many draws", async () => {
    // 31^12 is large enough that a duplicate in a few hundred draws means the
    // generator is not actually drawing random symbols.
    const { generateInviteCode } = await import("@asm/db");
    const codes = new Set<string>();
    for (let index = 0; index < 500; index += 1) {
      codes.add(generateInviteCode());
    }
    expect(codes.size).toBe(500);
  });

  test("spreads across the alphabet rather than favouring its head", async () => {
    // A plain `% alphabet.length` over random bytes biases toward the first few
    // symbols, because 256 is not a multiple of 31. Rejection sampling is the
    // fix, and this is the test that would notice if it were removed: the head
    // of the alphabet must not be disproportionately common.
    const { generateInviteCode } = await import("@asm/db");
    const first = new Set(DEN_INVITE_CODE_ALPHABET.slice(0, 3));
    let head = 0;
    const total = 300;
    for (let index = 0; index < total; index += 1) {
      const code = generateInviteCode();
      for (const character of code) {
        if (first.has(character)) {
          head += 1;
        }
      }
    }
    const characters = total * DEN_LIMITS.inviteCodeLength;
    const share = head / characters;
    // Unbiased expectation is 3/31 = 9.7%. A naive modulo would put the three
    // lowest symbols at roughly 3 * 8/256 = 9.4% plus their natural share,
    // which is only detectable as a skew, so the bound is loose but directional:
    // it fails if the head collapses toward zero, which is what an off-by-one in
    // the rejection limit would produce.
    expect(share).toBeGreaterThan(0.03);
    expect(share).toBeLessThan(0.2);
  });
});
