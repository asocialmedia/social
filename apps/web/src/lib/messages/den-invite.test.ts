import { describe, expect, test } from "bun:test";

import { DEN_LIMITS } from "@asm/db/messages/dens";

import type { DenInvitePreviewResponse } from "./client";
import type { DenExpiredInvite } from "./den-invite";
import {
  DEN_JOIN_PATH_PREFIX,
  denAskOwner,
  denInvitePath,
  denInviteUrl,
  denJoinActionLabel,
  denJoinDescription,
  denJoinDismiss,
  denJoinDismissesToMessages,
  denJoinFailure,
  denJoinOutcome,
  denJoinTitle,
} from "./den-invite";

// The live shape, which is the one that has not changed: no `expired` key, no
// `ownerId`, so a reader holding a working code is told nothing new.
function preview(
  overrides: Partial<DenInvitePreviewResponse> = {}
): DenInvitePreviewResponse {
  return {
    den: { id: "den-1", memberCount: 7, name: "Study group" },
    isMember: false,
    ...overrides,
  };
}

// The retired shape, which is the same den plus the one field a screen can act on.
function expiredPreview(
  ownerId: string | null = "owner-1",
  overrides: Partial<{ isMember: boolean; name: string | null }> = {}
): DenInvitePreviewResponse {
  return {
    den: {
      id: "den-1",
      memberCount: 7,
      name: overrides.name === undefined ? "Study group" : overrides.name,
      ownerId,
    },
    expired: true,
    isMember: overrides.isMember ?? false,
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
    // The 404 the route answers for a code that never resolved, for one whose den
    // has been dissolved, and for one the archive could not be read to explain. All
    // three are the same thing to the reader, and none of them may render a name and
    // a count the client could not read.
    expect(denJoinOutcome({ preview: null })).toEqual({
      kind: "invalid",
      reason: "unknown-code",
    });
  });

  test("a retired code is its own state, carrying the den and its owner", () => {
    // The state this whole file was changed for. A reader who was invited and then
    // had the code rotated out from under them used to land on `invalid`, which is a
    // dead end with nobody named in it - so there was no telling them who to ask.
    expect(denJoinOutcome({ preview: expiredPreview() })).toEqual({
      den: {
        id: "den-1",
        memberCount: 7,
        name: "Study group",
        ownerId: "owner-1",
      },
      kind: "expired",
    });
  });

  test("a retired code with no owner is still the expired state", () => {
    // The den's owner account can be deleted, and the screen has to be able to say
    // "this link is dead" about a den whose owner it cannot name. Degrading here
    // instead would tell somebody their link never resolved, which is false.
    const outcome = denJoinOutcome({ preview: expiredPreview(null) });
    expect(outcome.kind).toBe("expired");
    expect(outcome).toMatchObject({ den: { ownerId: null } });
  });

  test("a reader already inside a den whose code was retired is not sent to ask", () => {
    // The member case, and the reason the expired screen checks membership first. A
    // member who re-opens an old link has been in the room the whole time, and the
    // owner they would be invited to message is somebody they are already in a den
    // with - so this must reuse the state that just opens the den, not manufacture a
    // conversation to ask a question nobody needs answered.
    expect(
      denJoinOutcome({ preview: expiredPreview("owner-1", { isMember: true }) })
    ).toMatchObject({ kind: "already-member" });
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
    expect(denJoinTitle(outcome)).toBe("We couldn't find that den");
    // And it offers nothing to commit, because there is nothing to commit. The one
    // thing it does offer is a dismissal, which the screen draws itself.
    expect(denJoinActionLabel(outcome, false)).toBeNull();
    expect(denJoinActionLabel(outcome, true)).toBeNull();
  });

  test("a retired code's title is the product owner's, unaltered", () => {
    // Verbatim, because the tone is the point. A reader who was invited and then had
    // the code rotated away from under them must not be told they were wrong about
    // their own link - and "seems to be" plus "us" is what makes a dead-end screen
    // read as the product's problem rather than the reader's.
    const outcome = denJoinOutcome({ preview: expiredPreview() });
    expect(denJoinTitle(outcome)).toBe("This den seems to be hiding from us");
  });

  test("a retired code's sentence says the den is real and the code is not", () => {
    // The den's name is the reassurance; the code is the news. A reader who is only
    // told the code changed learns nothing about what they lost, and a reader who is
    // only told the den is fine learns nothing about why they cannot get in.
    const outcome = denJoinOutcome({ preview: expiredPreview() });
    const description = denJoinDescription(outcome);
    expect(description).toContain("Study group");
    expect(description).toContain("still here");
    expect(description).toContain("replaced");
    // Nothing to commit: a retired code grants nothing, so a join button here would
    // be a button the server refuses.
    expect(denJoinActionLabel(outcome, false)).toBeNull();
  });

  test("an unnamed retired den still says the den is real", () => {
    // "This den has no name yet" is true and useless here: the whole job of the
    // sentence is to distinguish "the room exists" from "the link is dead".
    const outcome = denJoinOutcome({
      preview: expiredPreview("owner-1", { name: null }),
    });
    expect(denJoinDescription(outcome)).toBe(
      "This den is still here, but the code in this link has been replaced."
    );
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

  test("the full state is still reachable, and the unknown sentence no longer claims it", () => {
    // The join route answers a full den with the same 404 as a dead code, so `full`
    // is reachable ONLY from the preview's member count - deleting the branch would
    // not simplify anything, it would lose the only telling that a den is full at
    // all. Asserted from the boundary so the two halves cannot drift: `full` is
    // decided at the ceiling, and the unknown sentence does not advertise a cause it
    // can no longer detect.
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
    const unknown = denJoinDescription(denJoinOutcome({ preview: null }));
    // Two facts only, both of which the reader can check themselves.
    expect(unknown).toContain("cut short");
    expect(unknown).toContain("mistyped");
    expect(unknown).toContain("gone");
    // Not the causes this screen can no longer tell apart, and not an accusation.
    expect(unknown).not.toContain("retired");
    expect(unknown).not.toContain("filled up");
    expect(unknown).not.toContain("not valid");
  });

  test("an unnamed den says so rather than rendering a gap", () => {
    const outcome = denJoinOutcome({
      preview: preview({ den: { id: "d", memberCount: 2, name: null } }),
    });
    expect(denJoinDescription(outcome)).toBe("This den has no name yet.");
  });
});

describe("denJoinDismiss", () => {
  test("goes back when there is somewhere to go back to", () => {
    // The link was opened out of a chat, so the reader's own thread is one step back
    // and that is where "Nevermind" should land them.
    const calls: string[] = [];
    denJoinDismiss({
      back: () => {
        calls.push("back");
      },
      historyLength: 4,
      replace: (href) => {
        calls.push(`replace:${href}`);
      },
    });
    expect(calls).toEqual(["back"]);
  });

  test("falls back to messages when the link was opened cold", () => {
    // A tab opened straight onto the link has no history, and `router.back()` there
    // walks out of the app - closing the tab on mobile and taking whatever the reader
    // had in it with them. The floor is this screen's own index, which is never a
    // wrong answer.
    const calls: string[] = [];
    denJoinDismiss({
      back: () => {
        calls.push("back");
      },
      historyLength: 1,
      replace: (href) => {
        calls.push(`replace:${href}`);
      },
    });
    expect(calls).toEqual(["replace:/messages"]);
  });

  test("the boundary is a bound, not an equality", () => {
    // A length of 0 is not reachable in a live document, but a platform that reports
    // something else must degrade rather than walk out of the app.
    expect(denJoinDismissesToMessages(0)).toBe(true);
    expect(denJoinDismissesToMessages(1)).toBe(true);
    expect(denJoinDismissesToMessages(2)).toBe(false);
  });
});

describe("denAskOwner", () => {
  test("opens the owner's message, then hands over to the deep link", () => {
    // The order is the property. The deep link creates-or-finds the conversation on
    // the messages page, which is the product's existing route and the reason this
    // screen owns no conversation-creation code; what it must not do is navigate
    // there BEFORE knowing the message opens.
    const order: string[] = [];
    const opened = denAskOwner({
      navigate: (path) => {
        order.push(`navigate:${path}`);
      },
      openDirectMessage: (ownerId) => {
        order.push(`open:${ownerId}`);
        return Promise.resolve({});
      },
      ownerId: "owner-1",
    });
    expect(order).toEqual(["open:owner-1"]);
    return expect(opened).resolves.toBe(true);
  });

  test("hands over to /messages?dm=<ownerId>, the link the app already reads", async () => {
    const paths: string[] = [];
    await denAskOwner({
      navigate: (path) => {
        paths.push(path);
      },
      openDirectMessage: () => Promise.resolve({}),
      ownerId: "owner-1",
    });
    expect(paths).toEqual(["/messages?dm=owner-1"]);
  });

  test("refuses to navigate when the message cannot be opened", async () => {
    // The 403 a follow gate or a block produces, and the 409 a missing Messages
    // identity produces, both land here. The deep link would have opened the
    // messages page and toasted about a stranger; not navigating at all leaves the
    // reader on a screen that can degrade to something honest.
    const paths: string[] = [];
    await expect(
      denAskOwner({
        navigate: (path) => {
          paths.push(path);
        },
        openDirectMessage: () =>
          Promise.reject(new Error("You can only message people you follow")),
        ownerId: "owner-1",
      })
    ).resolves.toBe(false);
    expect(paths).toEqual([]);
  });

  test("degrades on a failure it cannot characterise too", async () => {
    // A 500 or a dropped connection is not "the den is hiding from us", and this
    // screen has no state that could honestly say so - so it falls back to the same
    // dead end rather than inventing a claim.
    const paths: string[] = [];
    await expect(
      denAskOwner({
        navigate: (path) => {
          paths.push(path);
        },
        openDirectMessage: () => Promise.reject(new Error("socket hang up")),
        ownerId: "owner-1",
      })
    ).resolves.toBe(false);
    expect(paths).toEqual([]);
  });
});

// The retired preview's shape is the other half of the contract with the route, and
// it is derived from the response type rather than written out here, so these
// assertions are about the values and not about a parallel declaration.
describe("DenExpiredInvite", () => {
  test("is the preview's den plus the one field a screen can act on", () => {
    const den: DenExpiredInvite = {
      id: "den-1",
      memberCount: 7,
      name: "Study group",
      ownerId: null,
    };
    expect(Object.keys(den).toSorted()).toEqual([
      "id",
      "memberCount",
      "name",
      "ownerId",
    ]);
  });
});
