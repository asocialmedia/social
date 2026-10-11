// What the composer says, as pure functions.
//
// The composer is a client component entangled with the session, the identity key,
// attachments and the send path, so none of its copy renders in a test without
// standing all of that up first. The wording is pure, and so are assertable on its
// own. Same reasoning, and the same shape, as `access-ended.ts`.
//
// Three rules live here, and all three exist because the composer was reading the
// wrong thing:
//
//   - A DEN has no single peer. The composer used to take the first member who was
//     not the reader and address them by name, so a group the reader had just
//     created offered "Message Noah…" as though it were a private chat with one of
//     its members. `message-thread.tsx` already refuses to hand a den a peer for
//     exactly this reason; the composer now asks for a name the same way.
//   - The one name a den can be addressed by is the one it CHOSE. A den's fallback
//     label enumerates its members ("Ada, Grace and 3 more"), which is a fine
//     heading and a terrible thing to type at somebody, so an unnamed den gets its
//     own short line instead.
//   - A disabled input has to SAY why it is disabled. A greyed box reading
//     "Message Noah…" tells a removed member nothing at all, which is the state
//     that made a finished conversation look like a broken one.
//
// The den is passed as an explicit `isDen` rather than inferred from `denName`,
// because an unnamed den is one of the cases this exists for and "no name" must
// not be able to read as "not a den".

// Why the input is disabled. Also the composer placeholder while it is, so the
// reason and the disabled control are one sentence rather than two.
export const NOT_A_MEMBER_COMPOSER_PLACEHOLDER =
  "You can't send messages because you're not a member of this den";

// A den nobody named. Deliberately not the member list: see the module header.
export const UNNAMED_DEN_COMPOSER_PLACEHOLDER = "Message the den…";

// Editing is the reader's own work on their own message, so it is named before
// anything about who they are talking to.
const EDIT_PLACEHOLDER = "Edit message…";

// The placeholder for the empty composer.
//
// `writeBlockedByMembership` is `accessEnded` from the thread: the server has said
// this member is no longer inside the conversation. It wins over everything,
// including edit mode, because it is the only state in which the reader cannot act
// at all and the input is the thing that needs to explain itself.
export function composerPlaceholder(input: {
  // The den's own name, trimmed. Ignored for a DM, and empty or null for a den
  // that was created without one.
  denName: string | null;
  editing: boolean;
  // An explicit discriminator rather than inferring the den from `denName`: a den
  // with no name is the case this whole function exists for, so "no name" must not
  // be able to read as "not a den".
  isDen: boolean;
  peerDisplayName: string | null;
  writeBlockedByMembership: boolean;
}): string {
  if (input.writeBlockedByMembership) {
    return NOT_A_MEMBER_COMPOSER_PLACEHOLDER;
  }
  if (input.editing) {
    return EDIT_PLACEHOLDER;
  }
  if (input.isDen) {
    const named = input.denName?.trim() ?? "";
    return named.length > 0
      ? `Message ${named}…`
      : UNNAMED_DEN_COMPOSER_PLACEHOLDER;
  }
  return `Message ${input.peerDisplayName ?? "them"}…`;
}

// The name on a "Replying to" bar whose own sender did not resolve.
//
// The thread resolves almost every one of these from the message row, so this is
// the narrow remainder: a parent that is still decrypting, or one whose sender has
// left. In a den the answer cannot be a single member's name for the same reason
// the placeholder cannot be, so it is the neutral word instead.
export function replySenderFallbackName(input: {
  isDen: boolean;
  peerDisplayName: string | null;
  senderIsMe: boolean;
}): string {
  if (input.senderIsMe) {
    return "yourself";
  }
  if (input.isDen) {
    return "someone";
  }
  return input.peerDisplayName ?? "them";
}
