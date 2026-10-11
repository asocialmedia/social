import { DEN_LIMITS } from "@asm/db/messages/dens";

// The den member ceiling, as the CLIENT sees it.
//
// `DEN_LIMITS` is the authority; the service re-checks the cap under its claim
// lock because the client cannot be trusted. The UI still has to honour it, for
// the ordinary reason: a picker that lets somebody select a hundred and one
// people teaches them the product is broken, and a details panel that offers
// "add members" on a full den is offering a button the server will refuse.
//
// So the arithmetic lives here rather than inline in the two components that need
// it, and it reads the constant rather than a number. Both of those matter, and
// the second one is a thing that was previously true in one place and not the
// other: the create dialog did `membersMax - 1` inline and the details panel did
// `membersMax - members.length` inline, with nothing asserting that they and the
// service meant the same thing.

// How many more people a den being CREATED can take. The creator is already in,
// so the room is the ceiling less one. Zero would be wrong here (a create needs
// at least one other person) and negative is clamped so the picker cannot be
// handed a negative ceiling.
export function denCreateRoom(): number {
  return Math.max(0, DEN_LIMITS.membersMax - 1);
}

// How many more people a den that already holds `currentMembers` can take. Zero
// means full, and the panel uses that to hide the control rather than to disable
// it: a "full" line and a live "add" button cannot both be true.
export function denAddRoom(currentMembers: number): number {
  return Math.max(0, DEN_LIMITS.membersMax - currentMembers);
}

// Whether a den of this size is at the ceiling.
//
// The same comparison the join service makes under its claim lock, so the join
// screen's "this den is full" and the server's refusal are one rule rather than
// two. Getting this wrong in the permissive direction means offering a Join
// button that answers 404; getting it wrong in the strict direction means
// refusing a join the server would have accepted.
export function denIsFull(memberCount: number): boolean {
  return memberCount >= DEN_LIMITS.membersMax;
}

// How many more people the reader must pick before a create is worth sending.
// The minimum counts the reader, who is always in the den, so the dialog needs
// one other person rather than two others.
export function denCreateNeedsOthers(): number {
  return Math.max(0, DEN_LIMITS.membersMin - 1);
}
