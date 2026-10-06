// The den invite link, and what the screen at the end of it has to say.
//
// The link is the widest door in the product: anyone holding the URL can
// present it, so the surface on the other end has to be honest about the things
// that can happen there without leaking anything about the den.
//
//   - the code resolves and the reader can join (or is already inside);
//   - the code has been RETIRED by a rotation, which names the den and its owner
//     so the reader can go and ask for a new invite;
//   - the code does not resolve at all, which is a dead end and must read as a
//     dead end rather than as an error;
//   - the viewer has no message identity, which is the one actionable refusal,
//     and it carries a link to the screen that fixes it.
//
// The retired case is why this file is not just a copy deck. It used to be folded
// into "invalid", and the cost of that was a reader who had been invited, then had
// the code rotated out from under them, being told the link was broken with no way
// to find out who to ask. Naming the owner is the whole fix, and the preview route
// is where the disclosure behind it is justified.
//
// Pure so each of those is unit-tested as a decision rather than as a rendered
// branch, and so the link can be built and asserted without a DOM.

import { DEN_LIMITS } from "@asm/db/messages/dens";

import type { DenInvitePreviewResponse } from "./client";
import { DEN_BAN_JOIN_DESCRIPTION, DEN_BAN_JOIN_TITLE } from "./den-ban-copy";
import { denIsFull } from "./den-capacity";

// Where the join screen lives. A path rather than a bare function so the invite
// link and the client-side navigation cannot drift onto two different routes.
export const DEN_JOIN_PATH_PREFIX = "/messages/join";

function normalizeCode(code: string): string {
  // Codes are lowercase and unambiguous, so a pasted code is normalized the same
  // way the server normalizes before comparing. Trimming here means a code
  // carried across with a trailing space still resolves rather than 404ing.
  return code.trim().toLowerCase();
}

// The join screen's path for a code. An empty or whitespace-only code has no
// screen to open, so it answers the messages index rather than producing a link
// to `/messages/join/` that would 404 on the server.
export function denInvitePath(code: string): string {
  const normalized = normalizeCode(code);
  if (normalized.length === 0) {
    return "/messages";
  }
  return `${DEN_JOIN_PATH_PREFIX}/${encodeURIComponent(normalized)}`;
}

// The absolute link a manager copies. Origin first because the clipboard gets a
// full URL, and a same-origin path pasted into a chat elsewhere is a dead link.
export function denInviteUrl(origin: string, code: string): string {
  const normalized = normalizeCode(code);
  const trimmedOrigin = origin.trim().replace(/\/+$/u, "");
  if (normalized.length === 0) {
    return `${trimmedOrigin}/messages`;
  }
  return `${trimmedOrigin}${denInvitePath(normalized)}`;
}

// Where the expired screen's primary action goes: the deep link the messages page
// already reads to create-or-find a DM with somebody (`?dm=`). Reusing it rather
// than opening a DM from here means the join screen owns no conversation-creation
// code at all, and the thread that opens is the ordinary one the reader would have
// got from a profile's Message button.
//
// The id is encoded even though a user id cannot contain a slash: this string ends
// up in a URL that a reader can also copy, and the other paths in this file treat
// a code as untrusted for the same reason.
export function denAskOwnerPath(ownerId: string): string {
  return `/messages?dm=${encodeURIComponent(ownerId)}`;
}

// Whether "Nevermind" has somewhere to go back to.
//
// A dismissal, so it must not walk out of the app on a tab that opened this link
// directly: with no history, `router.back()` leaves the tab the reader opened the
// link in and takes whatever they had in it with them. The messages index is the
// floor - it is where this screen lives, so going there is never a wrong answer, and
// it is the destination the old "Go to messages" button used.
//
// `historyLength <= 1` rather than `=== 1`: a length of 0 is not reachable in a live
// document, but a bound degrades on any platform that reports something else instead
// of walking out.
export function denJoinDismissesToMessages(historyLength: number): boolean {
  return historyLength <= 1;
}

// What pressing "Nevermind" does, given the three things it needs. Split from the
// component so the decision is testable without a DOM: this repo has no browser
// environment, and a helper that took the router object would have nothing to drive
// it with.
export function denJoinDismiss(input: {
  back: () => void;
  historyLength: number;
  replace: (href: string) => void;
}): void {
  if (denJoinDismissesToMessages(input.historyLength)) {
    input.replace("/messages");
    return;
  }
  input.back();
}

// Pressing "Ask for a new invite": open a DM with the den's owner, then hand over to
// the messages page's own `?dm=` deep link.
//
// The message is opened HERE rather than by the deep link, and that ordering is the
// whole reason this button cannot go nowhere. A DM is follow-gated, blocks are
// DM-only, and both ends need a Messages identity, so the conversations route answers
// 403 for the first two and 409 for the third - which the deep link would turn into
// a destructive toast on the messages screen, after the reader has already left the
// join screen with no way back. Opening it first means a refusal is answered while
// this screen is still on the stack, where an honest answer exists.
//
// Returns whether the reader got their message, and the caller degrades to the
// unknown state when they did not. ANY failure degrades, not only the two statuses
// above: this screen's job is to stay readable, and the unknown state is readable.
// The create-or-find is idempotent, so the deep link that follows finds the same
// conversation rather than making a second one.
//
// `openDirectMessage` and `navigate` are injected rather than imported so this stays
// testable with no browser environment, and so nothing here can navigate without
// having proved the destination opens first.
export async function denAskOwner(input: {
  navigate: (path: string) => void;
  openDirectMessage: (ownerId: string) => Promise<unknown>;
  ownerId: string;
}): Promise<boolean> {
  try {
    await input.openDirectMessage(input.ownerId);
  } catch {
    return false;
  }
  input.navigate(denAskOwnerPath(input.ownerId));
  return true;
}

// The den a retired code named, as the preview reported it: the same facts a live
// code gets, plus the owner because it is the only one anybody can act on. Derived
// from the response type rather than written out, so a column added to the retired
// preview cannot silently stop reaching this screen.
export type DenExpiredInvite = Extract<
  DenInvitePreviewResponse,
  { expired: true }
>["den"];

// What the join screen shows before anybody commits.
//
// `invalid` carries no den at all: an unresolvable code must not render a name
// and a count it could not read, so the state is the whole answer.
//
// `expired` DOES carry a den, and that is the change this file exists for. The
// reader was invited, the code was then rotated away, and the only useful thing
// the screen can say is which room it was and who to ask - so it says both, and
// `ownerId` is nullable because the den's owner account can be gone.
//
// `full` is decided HERE rather than after the press, from the member count the
// preview already returned. That is not only better copy, it is what lets the
// join route answer a full den with the same 404 as a dead code without
// telling the reader anything they were not already told: the count is in the
// preview, so a caller who learns "full" here has lost nothing, and a caller
// guessing codes cannot tell a full den from a dead one. It is still the ONLY
// path to that state: the join route collapses LIMIT_REACHED into the shared 404,
// so deleting this branch would not simplify anything, it would lose the only
// telling that a den is full at all.
//
// A member of a full den is still shown as a member. Being inside is the fact
// the screen acts on, and the ceiling is a rule about who can join, not about
// who can open what they are already in.
export type DenJoinOutcome =
  | { den: DenInvitePreviewResponse["den"]; kind: "banned" }
  | { kind: "invalid"; reason: "unknown-code" }
  | { den: DenExpiredInvite; kind: "expired" }
  | { den: DenInvitePreviewResponse["den"]; kind: "full" }
  | { kind: "already-member"; den: DenInvitePreviewResponse["den"] }
  | { kind: "joinable"; den: DenInvitePreviewResponse["den"] };

export function denJoinOutcome(input: {
  preview: DenInvitePreviewResponse | null;
}): DenJoinOutcome {
  const { preview } = input;
  if (!preview) {
    return { kind: "invalid", reason: "unknown-code" };
  }
  // Before `isMember`, and deliberately. A reader who is currently inside this den
  // and re-opens a link whose code has since rotated is not an outsider being
  // pointed at a stranger: `ownerId` is the den's own owner, so the expired screen
  // would offer to open a DM with the person who owns the room the reader is
  // already in. That is harmless but it is noise, and the one thing this state must
  // never do is talk somebody into messaging a den's owner for no reason. So the
  // owner is only ever named to somebody the den has not admitted yet.
  //
  // A departed member is not "currently inside", so on a retired link they reach the
  // expired screen like anybody else holding a dead code. That is deliberate: the
  // screen's one job is to name who can mint a replacement, and it discloses no more
  // to somebody who was once in the room than it already does to a stranger. Keeping
  // the old row-exists reading here would mean two definitions of `isMember`, which is
  // what produced the "already in this den" bug in the first place.
  if (preview.expired) {
    return preview.isMember
      ? { den: preview.den, kind: "already-member" }
      : { den: preview.den, kind: "expired" };
  }
  // The ban is checked BEFORE `isMember`, and it has to be.
  //
  // `isMember` means "currently inside this den" - the route answers it with
  // `getDenMembership` AND `isCurrentDenMember`, because leaving and removal set
  // `leftAt` rather than deleting the row. It used to mean only "a row exists", and
  // that is why a kicked or departed member holding a live link was told "You're
  // already in this den": their row was still there, so the flag was true and this
  // arm swallowed them before the Join offer below could be reached.
  //
  // The ban is still checked first, because a ban and membership are independent:
  // a banned account always has a row (banning a stranger is refused), so `isMember`
  // is false for them and this arm is what names the reason. Preferring the ban is
  // also the direction that fails closed.
  //
  // Safe to answer from the preview because it answers only about the account making
  // the request. It is never a property of the den and never about anybody else, so
  // this cannot become a way to ask whether a particular person has been excluded.
  if (preview.isBanned === true) {
    return { den: preview.den, kind: "banned" };
  }
  if (preview.isMember) {
    return { den: preview.den, kind: "already-member" };
  }
  // Before the capacity check, for the reason the service checks it in the same place:
  // a banned person in a full room must be told they are banned, because "this den is
  // full" is a problem they cannot solve and sends them off to wait for room that may
  // never come.
  // The same comparison the join service makes under its claim lock, so the
  // screen's "full" and the server's are one rule rather than two.
  return denIsFull(preview.den.memberCount)
    ? { den: preview.den, kind: "full" }
    : { den: preview.den, kind: "joinable" };
}

// What a refused JOIN has to say, keyed off the status the route answered with.
//
//   - 404: the code stopped resolving between the preview and the press, or the
//     den filled up in the gap. The route answers all of those the same way on
//     purpose (see the join route), so the screen has to say a dead end and not
//     distinguish which dead end it is. A code that was rotated away reaches this
//     too, when the preview that named it was fetched before the rotation landed
//     and the press landed after it - which is why the retired case cannot be
//     answered from a refusal at all.
//   - 403 with a BANNED code: this account was kept out of this den on purpose. It is
//     the one refusal that names itself, and the route forwards it deliberately - see
//     the comment there. It is keyed off the CODE and not the status because 403 is
//     also the generic "you may not do that", and answering a ban with "that didn't
//     come back from the server" would be both useless and wrong.
//   - 409: the viewer has no message identity. Actionable, and the one that needs
//     somewhere to send them.
//   - 429: rate limited. Real, expected, and different from "invalid".
//   - anything else, including 403: a failure this screen cannot characterise, so
//     it says so rather than guessing.
//
// The 403 deserves a note, because it used to mean "blocked" and meant it well.
// It no longer can: blocks are DM-only, a den admits regardless of them, and
// `joinDenByInviteCode` has no FORBIDDEN code to throw, so this route has no 403
// of its own. If one ever reaches the client it came from somewhere this screen
// cannot see - a proxy, or a rule nobody has written yet - which makes
// `unavailable` the honest answer. `invalid` would be a lie (the code is fine) and
// `rate-limited` would be a guess, and both send the reader off chasing something
// that is not the problem.
export type DenJoinFailure =
  | "banned"
  | "invalid"
  | "needs-messages"
  | "rate-limited"
  | "unavailable";

export function denJoinFailure(
  status: number | null,
  code?: string | undefined
): DenJoinFailure {
  if (status === 403 && code === "BANNED") {
    return "banned";
  }
  if (status === 404) {
    return "invalid";
  }
  if (status === 409) {
    return "needs-messages";
  }
  if (status === 429) {
    return "rate-limited";
  }
  return "unavailable";
}

// The headline for each state. Separated from the outcome so the outcome stays
// a decision about facts and this stays a decision about words.
export function denJoinTitle(outcome: DenJoinOutcome): string {
  switch (outcome.kind) {
    case "invalid": {
      return "We couldn't find that den";
    }
    case "expired": {
      // Verbatim from the product owner, and not reworded: the tone is the point
      // ("seems to be", "us"). A screen that tells somebody they were wrong about
      // their own link is the failure this state exists to stop.
      return "This den seems to be hiding from us";
    }
    case "full": {
      return "This den is full";
    }
    case "banned": {
      return DEN_BAN_JOIN_TITLE;
    }
    case "already-member": {
      return "You're already in this den";
    }
    default: {
      return "Join this den?";
    }
  }
}

// The body for each state. `memberCount` is pluralised by the shared label
// rather than inline, so the join screen and the details header cannot disagree
// about how a den's size reads.
//
// The unknown sentence used to be a union of four things that are no longer
// reachable from here - a retired code (which has its own screen now), a den that
// filled up in the gap between the preview and the press (which the route answers
// as an unknown code, and which the reader was already told by the preview's count),
// and a truncated link. What is left is the honest pair: the link may not have come
// across whole, or the den is gone. Both are things the reader can check, so the
// sentence ends by handing them the check rather than by assigning blame.
export function denJoinDescription(outcome: DenJoinOutcome): string {
  if (outcome.kind === "invalid") {
    return "This link is cut short, mistyped, or points to a den that's gone. Check it and try again.";
  }
  const { name } = outcome.den;
  if (outcome.kind === "expired") {
    // The den's name is the reassurance and the code is the news: the reader needs
    // to know the room is real before "ask somebody" means anything, and a den with
    // no name of its own has to say so rather than render a gap in the sentence.
    return name
      ? `${name} is still here, but the code in this link has been replaced.`
      : "This den is still here, but the code in this link has been replaced.";
  }
  if (!name) {
    return "This den has no name yet.";
  }
  if (outcome.kind === "full") {
    return `${name} already has ${DEN_LIMITS.membersMax} members, which is as many as a den can hold.`;
  }
  if (outcome.kind === "banned") {
    // Says nothing about the den's name, deliberately. The reader cannot act on this
    // at all, so the only thing worth their attention is who can change it - and naming
    // the room here would just be a fact they cannot do anything with.
    return DEN_BAN_JOIN_DESCRIPTION;
  }
  return outcome.kind === "already-member"
    ? `Open ${name} to carry on.`
    : `You'll join ${name}.`;
}

// The label on the button that commits (or, for somebody already inside, the
// one that just opens the den). Kept with the outcome because the two cannot
// disagree: a joinable den gets "Join", a full one, an invalid one and an expired
// one get nothing to press here.
//
// Expired gets nothing because its actions are not a join - they are a message to
// the owner and a way out, which the expired screen draws itself. There is nothing
// here a press could commit, because a retired code commits nothing.
export function denJoinActionLabel(
  outcome: DenJoinOutcome,
  busy: boolean
): string | null {
  if (
    outcome.kind === "invalid" ||
    outcome.kind === "expired" ||
    outcome.kind === "full" ||
    outcome.kind === "banned"
  ) {
    return null;
  }
  if (busy) {
    return "Joining…";
  }
  return outcome.kind === "already-member" ? "Open den" : "Join den";
}

// How long an invite link still has, in the coarsest unit that is honest.
//
// The panel shows this next to the link, and its whole job is to answer "do I
// need to think about this yet". A link with weeks left reads as days; the
// moment the honest unit is hours, it says hours, and under an hour it says
// minutes - the granularity tightens as the deadline approaches because that is
// exactly when the number starts changing someone's behaviour. A link that
// never expires says so rather than rendering an absent line, because a missing
// line next to a door reads as a bug rather than as a promise.
//
// Past is not a state this answers: the panel switches to its expired card when
// `inviteExpiresAt` is in the past, so this helper is only ever called while the
// link is alive. A past instant still gets a label (clamped to zero) rather than
// a negative number, which keeps a clock skew between server and client from
// painting "-3d" on the screen.
export function denInviteCountdown(
  inviteExpiresAt: Date | null,
  now: Date = new Date()
): string {
  if (inviteExpiresAt === null) {
    return "No expiry";
  }
  const remaining = Math.max(0, inviteExpiresAt.getTime() - now.getTime());
  const minutes = Math.floor(remaining / 60_000);
  if (minutes < 1) {
    return "Expires in under a minute";
  }
  if (minutes < 60) {
    return `Expires in ${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    return `Expires in ${hours}h`;
  }
  const days = Math.floor(hours / 24);
  return `Expires in ${days}d`;
}

// Whether a link has already stopped opening the den, judged against an
// explicit `now` so the answer is a pure function of two timestamps rather than
// of the wall clock a component happens to render at. The server makes the same
// comparison at preview and join; this mirror exists for display only, and the
// two cannot disagree about a link the server has already answered, because the
// server's answer is the one that shipped the timestamp being compared.
export function denInviteIsExpired(
  inviteExpiresAt: Date | null,
  now: Date
): boolean {
  return inviteExpiresAt !== null && inviteExpiresAt.getTime() <= now.getTime();
}
