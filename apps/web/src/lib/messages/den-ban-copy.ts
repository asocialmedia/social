// What the product says about a den ban, and which controls a ban adds.
//
// Pure, for the reason `den-invite.ts` and `access-ended.ts` are pure: the panels
// that draw these are entangled with the session, the identity key and the roster
// query, and none of them renders in a test. The wording and the affordances are the
// parts that drift, so they live here where they can be asserted directly.
//
// One organising idea, and it is the reason this is not three screens:
//
//   Remove ends access NOW. Ban ends access AND locks the door.
//
// Everything below follows from that. A ban is not a more emphatic remove - it is a
// second, separate decision with its own dialog, its own place in the UI, and its own
// way back - because a reader who cannot tell the two apart will pick the wrong one,
// and picking the wrong one here means locking somebody out of a room they were about
// to come back to.

// The word. "Ban" rather than "block", because a block already means something
// specific and irreversible elsewhere in this product (a person blocking another
// account), and a manager choosing between the two would reasonably read "block" as
// the bigger hammer. It is the smaller one: it is scoped to one den and one press
// undoes it.
export const DEN_BAN_TERM = "Banned";

// The reason field's own label, and why it says who can read it.
//
// The audience is in the label rather than hidden in a tooltip because the two are the
// same decision: a moderator writing a note to other moderators needs to know it is
// one, and somebody who assumed the banned person reads it would write something
// different.
export const DEN_BAN_REASON_LABEL =
  "Reason (optional) — only owners and Elders see this";

// The confirmation for a ban. Says what happens immediately, what survives, and what
// it takes to change its mind, in that order: the immediate loss is what the reader is
// deciding, the history is the part people are surprised by, and the way back is what
// makes this a decision rather than a permanent verdict.
export function denBanConfirmCopy(memberName: string | null | undefined): {
  confirmLabel: string;
  description: string;
  title: string;
} {
  const name = memberName?.trim() || "This person";
  return {
    confirmLabel: `Ban ${name}`,
    description: `${name} loses access to this den immediately, and anything they've already read stays on their device. They won't be able to rejoin with an invite link or be added back until an owner or Elder unbans them.`,
    title: `Ban ${name}?`,
  };
}

// The confirmation for lifting a ban.
//
// The sentence that matters is the second one. Unbanning restores eligibility, not
// membership, and a reader who assumed otherwise would tell somebody "you're back in"
// when they are not - and would have said it in the room, where the transcript is
// encrypted to whoever holds the current epoch.
export function denUnbanConfirmCopy(memberName: string | null | undefined): {
  confirmLabel: string;
  description: string;
  title: string;
} {
  const name = memberName?.trim() || "This person";
  return {
    confirmLabel: `Unban ${name}`,
    description: `${name} can rejoin with an invite link or be added back. This does not add them to the den on its own.`,
    title: `Unban ${name}?`,
  };
}

// What a ban row says underneath the name, in priority order.
//
// Two facts are available - who imposed it and why - and the reason wins when there is
// one, because it is the thing a manager opening this list is looking for. The author
// is the fallback rather than a third line: a ban with no reason still has to say who
// did it, and stacking three rows per person turns a list somebody scans into a wall.
export function denBanRowSubtitle(ban: {
  bannedByName: string | null;
  reason: string | null;
}): string {
  const reason = ban.reason?.trim();
  if (reason) {
    return reason;
  }
  const author = ban.bannedByName?.trim();
  return author ? `Banned by ${author}` : DEN_BAN_TERM;
}

// The collapsed section's own line, and its count label.
//
// Stated rather than left to the reader because a section called "Banned" sitting in a
// member list is ambiguous about what it is blocking: it has to say that these people
// cannot come back, or a manager reads it as a mute list and cannot tell why somebody
// she invited is not arriving.
export const DEN_BANS_EMPTY = "No banned members.";
export const DEN_BANS_SUMMARY = "Blocked accounts can't rejoin until unbanned.";

// Why a banned candidate cannot be picked in the add-members picker.
//
// Second person, because the row is about the person who would be added and the picker
// is read by the person doing the adding - the same second-person convention
// `GROUP_ADD_REFUSAL_COPY` follows and for the same reason. It is also short, because
// it is appended after a username on a single line and a sentence would wrap.
export const DEN_BAN_PICKER_REFUSAL = "banned from this den";

// The copy for the add-members panel when a banned candidate reaches the route anyway,
// which happens on a race between the picker's read and the submit.
//
// The generic variant is not a fallback for laziness: the picker already knows which
// people are banned, so the server naming them is redundant, and a batch of five that
// fails because one of them is banned is the case where naming the four innocent ones
// helps nobody.
export function denBanAddRefusal(namedCount: number): string {
  return namedCount === 1
    ? "That person is banned from this den. Unban them from the banned list first."
    : "Some of those people are banned from this den. Unban them from the banned list first.";
}

// The join screen's state for somebody who holds a live link and cannot use it.
//
// The body names the way out and says who can take it, because a locked door with no
// stated remedy is the state that gets read as a bug and gets a support ticket. It does
// NOT name a person to contact: the reader may never have met whoever banned them, and
// offering to open a DM with a stranger on the strength of a link they were sent is
// exactly the thing the rest of this feature is careful not to do.
export const DEN_BAN_JOIN_TITLE = "You can't rejoin this den";
export const DEN_BAN_JOIN_DESCRIPTION =
  "This account is blocked from rejoining. If that's a mistake, ask an owner or Elder to unban you.";

// The one button this state gets.
//
// It is a way out rather than an action on the den, for the same reason the expired
// screen's buttons do not offer to join: a retired code commits nothing and a banned
// reader is refused either way, so there is no press here that could change their
// outcome and offering one would be a control that does nothing.
export const DEN_BAN_JOIN_DISMISS = "Back to messages";
