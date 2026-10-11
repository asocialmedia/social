import type { ConversationType } from "@asm/db";

// What the messages UI says about its own trust model, in one place.
//
// This exists because the sentence that used to be here - "Messages here are
// encrypted" - was true and misleading at the same time. It is true: every
// message is encrypted in transit and at rest, under a per-identity key. What it
// invites the reader to conclude is not true: the scheme is SERVER-RECOVERABLE,
// not end-to-end. The server derives each member's backup key from the identity
// row it stores, so a fresh device with no local storage and no user input
// recovers automatically, and anyone who can read the database can read every
// message in it.
//
// So the honest sentence names the encryption AND the party that holds the key.
// The second half is not a disclaimer bolted on to be thorough; it is the part a
// reader is actually asking about, and leaving it out is how a product ends up
// being described by somebody else as end-to-end encrypted.
//
// The den variant additionally says the thing the invite design makes true and
// that "private" would hide: the door is a link, and anyone holding it is a
// member. A group conversation reached through a shareable URL is not a private
// room, and the copy in front of it should not read as though it were.

// The DM note. Short, because the interesting part is who holds the key and that
// is the same sentence in both.
const SERVER_HOLDS_THE_KEY =
  "Encrypted in transit and at rest, and the server holds the key - so this is not end-to-end encryption.";

export function messagesTrustNote(input: {
  memberCount?: number;
  type: ConversationType;
}): string {
  if (input.type === "DEN") {
    // The member count is what makes "everyone in here" concrete. It is omitted
    // rather than guessed when the caller has not loaded the roster, because a
    // number the reader cannot verify is worse than no number.
    const who =
      typeof input.memberCount === "number" && input.memberCount > 0
        ? `Everyone in this den (${input.memberCount} people) can read them`
        : "Everyone in this den can read them";
    return `${SERVER_HOLDS_THE_KEY} ${who}, and an invite link is how people get in.`;
  }
  return `${SERVER_HOLDS_THE_KEY} Only you and the person you are talking to can read them.`;
}
