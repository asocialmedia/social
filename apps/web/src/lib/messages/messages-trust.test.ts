import { describe, expect, test } from "bun:test";

import { messagesTrustNote } from "./messages-trust";

// A den of seven. Named, and deliberately not 12: DEN_LIMITS.inviteCodeLength is
// 12, and the limits-consistency test flags any bare 12 in a line that talks
// about a den limit - including in a test. The fix for that is to move the
// fixture, never to widen the guard.
const SEVEN = 7;

// The trust sentence is load-bearing copy, so it is tested as copy.
//
// A regression here is not a diff nobody reads. "Encrypted" on its own reads as
// end-to-end to almost every reader, and this product is explicitly not
// end-to-end: the server derives each member's backup key from the identity row
// it stores, so recovery needs no device and no input, and anyone who can read
// the database can read every message. The sentence has to keep saying so.
//
// These assertions are therefore about words that must be PRESENT, not about
// phrasing that must not change. Rewording is fine; dropping the disclosure is
// not.

describe("messagesTrustNote", () => {
  test("never claims end-to-end encryption, and says why", () => {
    for (const type of ["DM", "DEN"] as const) {
      const note = messagesTrustNote({ type });
      // The disclosure itself.
      expect(note).toContain("server holds the key");
      // And the phrase it is correcting, so a reader who arrives with the wrong
      // assumption has it named rather than left to infer.
      expect(note).toContain("not end-to-end");
    }
  });

  test("names the encryption that is real", () => {
    // The sentence that used to be here, on its own, was true. It is kept, and it
    // is now the first clause of something larger rather than the whole claim.
    const note = messagesTrustNote({ type: "DM" });
    expect(note).toContain("Encrypted");
    expect(note).toContain("in transit and at rest");
  });

  test("a DM says who can read it", () => {
    const note = messagesTrustNote({ type: "DM" });
    expect(note).toContain("you and the person you are talking to");
  });

  test("a den says the room can read it, and how people get in", () => {
    // The gap this closes. A den is reached through a shareable link, so
    // describing one as a private room would be a claim the product does not
    // deliver - and the empty transcript is exactly where a reader decides
    // whether to trust what they are about to type into.
    const note = messagesTrustNote({ type: "DEN" });
    expect(note).toContain("Everyone in this den");
    expect(note).toContain("invite link is how people get in");
  });

  test("names the room's size when the caller has it, and omits it otherwise", () => {
    expect(messagesTrustNote({ memberCount: SEVEN, type: "DEN" })).toContain(
      `${SEVEN} people`
    );
    // A number the reader cannot verify is worse than no number, and a roster the
    // thread has not loaded is exactly that.
    expect(messagesTrustNote({ type: "DEN" })).not.toMatch(/\d+ people/u);
    expect(messagesTrustNote({ memberCount: 0, type: "DEN" })).not.toMatch(
      /\d+ people/u
    );
  });

  test("does not call a den private anywhere in the sentence", () => {
    // The word itself, not a synonym. A den is a group conversation with a
    // shareable door.
    expect(
      messagesTrustNote({ memberCount: SEVEN, type: "DEN" })
    ).not.toContain("private");
    expect(messagesTrustNote({ type: "DM" })).not.toContain("private");
  });
});
