import { describe, expect, test } from "bun:test";

import { renderToString } from "react-dom/server";

import { DenJoinFailureScreen } from "./client-join-den";

// The join screen's refused states, rendered rather than asserted on the pure
// decision alone. `denJoinFailure` already pins WHICH state a status maps to; what
// is untested in the pure module is the words, and the words are the part a person
// actually reads.
//
// React separates adjacent text nodes with a comment marker, so a rendered string
// can arrive with `<!-- -->` in the middle of a sentence, and it escapes an
// apostrophe in copy the reader plainly sees as a straight quote. Both are undone
// so the assertion is about the words rather than about the serialiser.
function visible(reason: Parameters<typeof DenJoinFailureScreen>[0]["reason"]) {
  return renderToString(<DenJoinFailureScreen reason={reason} />)
    .replaceAll(/<!--.*?-->/gu, "")
    .replaceAll("&#x27;", "'")
    .replaceAll("&apos;", "'")
    .replaceAll("&quot;", '"');
}

describe("the join screen's refused states", () => {
  test("the actionable refusal keeps its link to the screen that fixes it", () => {
    // The one refusal a reader can do something about, so it is the one that gets a
    // destination.
    const html = visible("needs-messages");
    expect(html).toContain("Turn on Messages first");
    expect(html).toContain('href="/messages"');
  });

  test("a dead link still reads as a dead link", () => {
    const html = visible("invalid");
    expect(html).toContain("This link is not valid");
    expect(html).toContain("retired");
    expect(html).not.toContain("blocked");
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
      const html = visible(reason);
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
    // ask for a code that was never the problem, and saying nothing at all is a
    // dead end with no way forward in it.
    const html = visible("unavailable");
    expect(html).toContain("Couldn't check this link");
    expect(html).not.toContain("not valid");
    expect(html).not.toContain("retired");
    expect(html).not.toContain("Ask whoever");
    // The way out is still offered, which is the one thing that can help.
    expect(html).toContain('href="/messages"');
  });
});
