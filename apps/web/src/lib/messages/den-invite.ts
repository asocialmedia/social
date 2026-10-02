// The den invite link, and what the screen at the end of it has to say.
//
// The link is the widest door in the product: anyone holding the URL can
// present it, so the surface on the other end has to be honest about the three
// things that can happen there without leaking anything about the den.
//
//   - the code does not resolve (it never existed, or it was rotated out), which
//     is a dead end and must read as a dead end rather than as an error;
//   - the viewer is already inside, which is a success and navigates silently;
//   - the viewer has no message identity, which is the one actionable refusal,
//     and it carries a link to the screen that fixes it.
//
// Pure so each of those is unit-tested as a decision rather than as a rendered
// branch, and so the link can be built and asserted without a DOM.

import { DEN_LIMITS } from "@asm/db/messages/dens";

import type { DenInvitePreviewResponse } from "./client";
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

// What the join screen shows before anybody commits.
//
// `invalid` carries no den at all: an unresolvable code must not render a name
// and a count it could not read, so the state is the whole answer.
//
// `full` is decided HERE rather than after the press, from the member count the
// preview already returned. That is not only better copy, it is what lets the
// join route answer a full den with the same 404 as a dead code without
// telling the reader anything they were not already told: the count is in the
// preview, so a caller who learns "full" here has lost nothing, and a caller
// guessing codes cannot tell a full den from a dead one.
//
// A member of a full den is still shown as a member. Being inside is the fact
// the screen acts on, and the ceiling is a rule about who can join, not about
// who can open what they are already in.
export type DenJoinOutcome =
  | { kind: "invalid"; reason: "unknown-code" }
  | { kind: "full"; den: DenInvitePreviewResponse["den"] }
  | { kind: "already-member"; den: DenInvitePreviewResponse["den"] }
  | { kind: "joinable"; den: DenInvitePreviewResponse["den"] };

export function denJoinOutcome(input: {
  preview: DenInvitePreviewResponse | null;
}): DenJoinOutcome {
  const { preview } = input;
  if (!preview) {
    return { kind: "invalid", reason: "unknown-code" };
  }
  if (preview.isMember) {
    return { den: preview.den, kind: "already-member" };
  }
  // The same comparison the join service makes under its claim lock, so the
  // screen's "full" and the server's are one rule rather than two.
  return denIsFull(preview.den.memberCount)
    ? { den: preview.den, kind: "full" }
    : { den: preview.den, kind: "joinable" };
}

// What a refused JOIN has to say, keyed off the status the route answered with.
//
//   - 404: the code stopped resolving between the preview and the press, or the
//     den filled up in the gap. The route answers both the same way on purpose
//     (see the join route), so the screen has to say a dead end and not
//     distinguish which dead end it is.
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
  | "invalid"
  | "needs-messages"
  | "rate-limited"
  | "unavailable";

export function denJoinFailure(status: number | null): DenJoinFailure {
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
      return "This link is not valid";
    }
    case "full": {
      return "This den is full";
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
export function denJoinDescription(outcome: DenJoinOutcome): string {
  if (outcome.kind === "invalid") {
    return "The join code has been retired, the link was cut short, or the den filled up while you were looking at it. Ask whoever shared it for a new one.";
  }
  const { name } = outcome.den;
  if (!name) {
    return "This den has no name yet.";
  }
  if (outcome.kind === "full") {
    return `${name} already has ${DEN_LIMITS.membersMax} members, which is as many as a den can hold.`;
  }
  return outcome.kind === "already-member"
    ? `Open ${name} to carry on.`
    : `You'll join ${name}.`;
}

// The label on the button that commits (or, for somebody already inside, the
// one that just opens the den). Kept with the outcome because the two cannot
// disagree: a joinable den gets "Join", a full one and an invalid one get
// nothing to press.
export function denJoinActionLabel(
  outcome: DenJoinOutcome,
  busy: boolean
): string | null {
  if (outcome.kind === "invalid" || outcome.kind === "full") {
    return null;
  }
  if (busy) {
    return "Joining…";
  }
  return outcome.kind === "already-member" ? "Open den" : "Join den";
}
