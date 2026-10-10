// One answer to "is this membership row somebody who has left the conversation",
// shared by the three surfaces that ask it: the rail row, the details sheet and
// the transcript's composer.
//
// The subtlety is the third state. A membership row carries `leftAt` as
// `Date | null` when it is a den row, and the column is absent entirely on a DM
// row and on a detail payload that has not resolved yet. So the field can be
// null, a Date, or undefined - and `undefined !== null` is true, which is how a
// freshly opened den came to render itself as read-only while its roster was
// still loading. The predicate below is the only place that distinction is made,
// so a caller cannot reintroduce it by writing the comparison inline.

// The minimum a caller has to have read off a conversation to ask the question.
export interface MembershipRow {
  leftAt?: Date | null;
  userId: string;
}

// Whether this membership has left. False when there is no row at all, and false
// when the row simply has no `leftAt` - both mean "not known to have departed",
// which is the only reading that is safe for a composer to gate on.
export function hasDeparted(
  membership: MembershipRow | undefined | null
): boolean {
  if (!membership) {
    return false;
  }
  return membership.leftAt !== null && membership.leftAt !== undefined;
}

// The viewer's own row out of a conversation's roster, as this module names it.
// Returns undefined when the roster has not resolved or the reader is not on it,
// which `hasDeparted` then reads as "has not left".
export function ownMembership(
  members: readonly MembershipRow[],
  userId: string
): MembershipRow | undefined {
  if (!userId) {
    return undefined;
  }
  return members.find((member) => member.userId === userId);
}
