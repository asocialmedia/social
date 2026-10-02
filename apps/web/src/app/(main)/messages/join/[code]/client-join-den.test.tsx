import { describe, expect, test } from "bun:test";

import { renderToString } from "react-dom/server";

import type { DenExpiredInvite } from "@/lib/messages/den-invite";
import { denJoinOutcome, denJoinTitle } from "@/lib/messages/den-invite";

import { DenExpiredScreen, DenJoinFailureScreen } from "./client-join-den";

// The join screen's refused states, rendered rather than asserted on the pure
// decision alone. `denJoinFailure` and `denJoinOutcome` already pin WHICH state a
// status or a preview maps to; what can only be checked here is what the screen
// actually draws, and both of these are claims about the WORDS and the CONTROLS a
// reader gets, which is the part a person acts on.
//
// No DOM: this repo has no browser environment, so every assertion below is against
// `renderToString` output. That is enough for the whole of what these screens are -
// their copy, which buttons exist, and each button's `type` and accessible name -
// and it is stated here rather than left for a reader to discover. What it cannot
// cover is the press itself, so the navigation is tested where the decision lives,
// in `den-invite.test.ts`.
//
// React separates adjacent text nodes with a comment marker, so a rendered string
// can arrive with `<!-- -->` in the middle of a sentence, and it escapes an
// apostrophe in copy the reader plainly sees as a straight quote. Both are undone
// so the assertion is about the words rather than about the serialiser.
function visible(html: string): string {
  return html
    .replaceAll(/<!--.*?-->/gu, "")
    .replaceAll("&#x27;", "'")
    .replaceAll("&apos;", "'")
    .replaceAll("&quot;", '"');
}

function den(overrides: Partial<DenExpiredInvite> = {}): DenExpiredInvite {
  return {
    id: "den-1",
    memberCount: 7,
    name: "Study group",
    ownerId: "owner-1",
    ...overrides,
  };
}

function expiredHtml(target: DenExpiredInvite, asking = false): string {
  return visible(
    renderToString(
      <DenExpiredScreen
        asking={asking}
        den={target}
        onAskOwner={() => {}}
        onNevermind={() => {}}
      />
    )
  );
}

function failureHtml(
  reason: Parameters<typeof DenJoinFailureScreen>[0]["reason"]
): string {
  return visible(
    renderToString(
      <DenJoinFailureScreen onNevermind={() => {}} reason={reason} />
    )
  );
}

// A `<button>` that submits nothing. Matched on the rendered `type` attribute, which
// is the only way to tell a safe control from one that could submit a surrounding
// form on some other surface later.
function buttonTypes(html: string): string[] {
  return [...html.matchAll(/<button[^>]*\stype="(?<control>[^"]+)"/gu)].flatMap(
    (match) => match.groups?.control ?? []
  );
}

describe("the retired-code screen", () => {
  test("says the product owner's title, word for word", () => {
    // This is the sentence the whole feature exists to be able to show, so it is
    // asserted as the literal string rather than as a match on its subject. "Seems
    // to be" and "us" are the tone: a reader who was invited and then had the code
    // rotated away from under them must not be told they were wrong about their own
    // link.
    expect(expiredHtml(den())).toContain("This den seems to be hiding from us");
  });

  test("offers both actions, with the primary first", () => {
    const html = expiredHtml(den());
    expect(html).toContain("Ask for a new invite");
    expect(html).toContain("Nevermind");
    // Primary before secondary, so the order a reader's eye takes is the order the
    // DOM takes and a screen reader hears the useful one first.
    expect(html.indexOf("Ask for a new invite")).toBeLessThan(
      html.indexOf("Nevermind")
    );
  });

  test("names the den, so the reader knows which room lost its code", () => {
    expect(expiredHtml(den())).toContain("Study group is still here");
  });

  test("shows the member count, which is the reader's proof the den is real", () => {
    expect(expiredHtml(den())).toContain("7 members");
    expect(expiredHtml(den({ memberCount: 1 }))).toContain("1 member");
  });

  test("every control is a button that submits nothing", () => {
    // Neither action is a form submit and neither is inside a form, but `type` is
    // the only thing that keeps that true if this screen is ever nested in one.
    const html = expiredHtml(den());
    expect(buttonTypes(html)).toEqual(["button", "button"]);
  });

  test("a busy primary says so instead of pretending to be available", () => {
    // The message takes a round trip, and a second press would open a second
    // conversation with the same person.
    const html = expiredHtml(den(), true);
    expect(html).toContain("Opening…");
    expect(html).not.toContain("Ask for a new invite");
    expect(html).toContain("disabled");
  });

  test("degrades to the unknown screen when the den has no owner to ask", () => {
    // The den's owner account can be deleted, and then "ask for a new invite" has
    // nobody to ask. Offering the button anyway is a control that goes nowhere;
    // degrading says the link does not resolve and still offers a way out, which is
    // true and useful.
    const html = expiredHtml(den({ ownerId: null }));
    expect(html).toContain("We couldn't find that den");
    expect(html).not.toContain("Ask for a new invite");
    expect(html).not.toContain("hiding from us");
    // The dismissal survives the degradation, so the screen still has a way out.
    expect(html).toContain("Nevermind");
  });

  test("an unnamed den still says the den is real", () => {
    // "This den has no name yet" is true and useless here: the sentence's whole job
    // is to separate "the room exists" from "the link is dead".
    const html = expiredHtml(den({ name: null }));
    expect(html).toContain(
      "This den is still here, but the code in this link has been replaced."
    );
  });

  test("never claims a block or a refusal stopped the reader", () => {
    // The rendered words are what a reader acts on. Blocks are DM-only and a den
    // admits regardless of them, so no state here can truthfully say one - and a
    // screen that did would send somebody to argue with the wrong person.
    const html = expiredHtml(den());
    expect(html).not.toContain("blocked");
    expect(html).not.toContain("Blocked");
    expect(html).not.toContain("not valid");
  });

  test("is not announced as an error", () => {
    // A dead end the reader walked into is not a fault of theirs, so nothing here
    // carries error semantics: no alert role, no assertive live region, no invalid
    // state. This is a claim about absence, which no assertion on the pure decision
    // can make, and which a redesign quietly puts back.
    const html = expiredHtml(den());
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain('aria-live="assertive"');
    expect(html).not.toContain("aria-invalid");
  });
});

describe("which screen a retired preview reaches", () => {
  test("goes through the same decision the component draws from", () => {
    // Resolving the preview to its screen here rather than handing `DenExpiredScreen`
    // a hand-built den, so this test fails if the outcome that selects it ever stops
    // selecting it. A render test for a screen nobody routes to proves the screen
    // exists and nothing about whether it is shown.
    const outcome = denJoinOutcome({
      preview: {
        den: {
          id: "den-1",
          memberCount: 7,
          name: "Study group",
          ownerId: "owner-1",
        },
        expired: true,
        isMember: false,
      },
    });
    expect(outcome.kind).toBe("expired");
    const html = expiredHtml(outcome.den);
    expect(html).toContain("This den seems to be hiding from us");
    expect(html).toContain("Ask for a new invite");
  });

  test("a member of that den reaches the screen that opens it instead", () => {
    // The other half of the same wiring: already inside, so the retired screen -
    // which exists to ask the owner for a new invite - must not be what is drawn.
    const outcome = denJoinOutcome({
      preview: {
        den: {
          id: "den-1",
          memberCount: 7,
          name: "Study group",
          ownerId: "owner-1",
        },
        expired: true,
        isMember: true,
      },
    });
    expect(outcome.kind).toBe("already-member");
    expect(denJoinTitle(outcome)).toBe("You're already in this den");
  });
});

describe("the join screen's refused states", () => {
  test("the actionable refusal keeps its link to the screen that fixes it", () => {
    // The one refusal a reader can do something about, so it is the one that gets a
    // destination.
    const html = failureHtml("needs-messages");
    expect(html).toContain("Turn on Messages first");
    expect(html).toContain('href="/messages"');
  });

  test("an unresolvable link reads as a dead end, in the product owner's words", () => {
    // The wording the owner asked for. The two facts it keeps are the two a reader
    // can act on - the link may not have come across whole, or the den is gone - and
    // it stops short of accusing anybody, because nothing here can tell which of the
    // two happened and a wrong accusation is worse than no claim.
    const html = failureHtml("invalid");
    expect(html).toContain("We couldn't find that den");
    expect(html).toContain("cut short");
    expect(html).toContain("mistyped");
    expect(html).toContain("gone");
    expect(html).not.toContain("not valid");
  });

  test("an unresolvable link offers one dismissal and nothing else", () => {
    // There is no den to name and nobody to ask, so a second button would be a
    // control with nothing behind it.
    const html = failureHtml("invalid");
    expect(html).toContain("Nevermind");
    expect(html).not.toContain("Ask for a new invite");
    expect(html).not.toContain("Join den");
    expect(html).not.toContain('href="/messages"');
    expect(buttonTypes(html)).toEqual(["button"]);
  });

  test("the dismissal is the same one the retired screen offers", () => {
    // From the reader's side the two dead ends are the same thing - this link is not
    // going to take them anywhere - so they must not read as two different products.
    expect(failureHtml("invalid")).toContain("Nevermind");
    expect(expiredHtml(den())).toContain("Nevermind");
  });

  test("a dismissal is not announced as an error", () => {
    const html = failureHtml("invalid");
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain('aria-live="assertive"');
    expect(html).not.toContain("aria-invalid");
  });

  test("nothing any state can render still claims a block stopped the join", () => {
    // The rendered words are what a reader acts on, and the block refusal had its
    // own screen with its own sentence. With blocks DM-only and a den admitting
    // regardless of them, there is no state left that can truthfully say it - so
    // every state is checked rather than only the one that used to exist.
    for (const reason of [
      "invalid",
      "needs-messages",
      "rate-limited",
      "unavailable",
    ] as const) {
      const html = failureHtml(reason);
      expect(html).not.toContain("blocked");
      expect(html).not.toContain("Blocked");
      expect(html).not.toContain("has blocked you");
    }
  });

  test("an uncharacterised failure says so instead of blaming the link", () => {
    // What a 403 from the join route now renders as, because that route has no
    // 403 of its own any more and the client still has to answer one if it arrives
    // from somewhere else. Two assertions, because the failure here is getting it
    // backwards in either direction: claiming the link is dead sends the reader to
    // check a link that was fine, and saying nothing at all is a dead end with no
    // way forward in it.
    const html = failureHtml("unavailable");
    expect(html).toContain("Couldn't check this link");
    expect(html).not.toContain("couldn't find that den");
    expect(html).not.toContain("retired");
    expect(html).not.toContain("Ask whoever");
    // The way out is still offered, which is the one thing that can help.
    expect(html).toContain('href="/messages"');
  });

  test("a throttled reader is told to wait rather than that their link is dead", () => {
    // Telling somebody a link is invalid because they pressed it a few times too
    // often would be a lie they would act on, and acting on it - asking whoever
    // shared it for a new code - would not help at all.
    const html = failureHtml("rate-limited");
    expect(html).toContain("Too many joins just now");
    expect(html).toContain("Wait a moment");
    expect(html).not.toContain("not valid");
  });
});
