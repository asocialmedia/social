// The den invite link and what the join screen says at the end of it, ported
// from apps/web/src/lib/messages/den-invite.ts. The link is the widest door
// in the product, so the screen is honest about every outcome without leaking
// anything about the den: joinable, already-member, full (decided from the
// preview count, before the press), expired (names the den and its owner so
// the reader can ask for a new invite), invalid (a dead end, not an error),
// and banned. Join refusals map statuses to the same five failure screens as
// web. Pure so each decision is unit-tested rather than rendered.
import type { DenInvitePreview } from "./client";
import { DEN_MEMBERS_MAX } from "./member-picker-rules";

// The join screen's path for a code. Shared with the invite link the settings
// panel copies, so the link and the navigation cannot drift apart.
export const DEN_JOIN_PATH_PREFIX = "/messages/join";

function normalizeCode(code: string): string {
  return code.trim().toLowerCase();
}

// An empty or whitespace-only code has no screen to open, so it answers the
// messages index rather than a join link that would 404.
export function denInvitePath(code: string): string {
  const normalized = normalizeCode(code);
  if (normalized.length === 0) {
    return "/messages";
  }
  return `${DEN_JOIN_PATH_PREFIX}/${encodeURIComponent(normalized)}`;
}

// The absolute link a manager copies. Origin first because the clipboard gets
// a full URL.
export function denInviteUrl(origin: string, code: string): string {
  const normalized = normalizeCode(code);
  const trimmedOrigin = origin.trim().replace(/\/+$/u, "");
  if (normalized.length === 0) {
    return `${trimmedOrigin}/messages`;
  }
  return `${trimmedOrigin}${denInvitePath(normalized)}`;
}

// Whether "Nevermind" has somewhere to go back to. With no history the
// messages index is the floor: this screen lives there, so going there is
// never a wrong answer.
export function denJoinDismissesToMessages(historyLength: number): boolean {
  return historyLength <= 1;
}

// Whether a den of this size is at the ceiling. The same comparison the join
// service makes under its claim lock, so the screen's "full" and the server's
// are one rule rather than two.
export function denIsFull(memberCount: number): boolean {
  return memberCount >= DEN_MEMBERS_MAX;
}

export type DenJoinOutcome =
  | { den: DenInvitePreview["den"]; kind: "banned" }
  | { kind: "invalid"; reason: "unknown-code" }
  | { den: DenInvitePreview["den"]; kind: "expired" }
  | { den: DenInvitePreview["den"]; kind: "full" }
  | { den: DenInvitePreview["den"]; kind: "already-member" }
  | { den: DenInvitePreview["den"]; kind: "joinable" };

export function denJoinOutcome(input: {
  preview: DenInvitePreview | null;
}): DenJoinOutcome {
  const { preview } = input;
  if (!preview) {
    return { kind: "invalid", reason: "unknown-code" };
  }
  // Expired before membership: a reader inside this den reopening a rotated
  // link is not an outsider, so they land on the open screen, not the
  // ask-the-owner screen.
  if (preview.expired) {
    return preview.isMember
      ? { den: preview.den, kind: "already-member" }
      : { den: preview.den, kind: "expired" };
  }
  // The ban is checked before membership and before capacity: a ban is a
  // decision about this account, and "this den is full" is a problem the
  // reader cannot solve.
  if (preview.isBanned === true) {
    return { den: preview.den, kind: "banned" };
  }
  if (preview.isMember) {
    return { den: preview.den, kind: "already-member" };
  }
  return denIsFull(preview.den.memberCount)
    ? { den: preview.den, kind: "full" }
    : { den: preview.den, kind: "joinable" };
}

export type DenJoinFailure =
  | "banned"
  | "invalid"
  | "needs-messages"
  | "rate-limited"
  | "unavailable";

// What a refused join has to say, keyed off the status (and the BANNED code
// when the route names it): 404 is a dead end, 409 has no message identity,
// 429 is rate limiting, anything else is a failure this screen cannot
// characterise, so it says so rather than guessing.
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

export function denJoinTitle(outcome: DenJoinOutcome): string {
  switch (outcome.kind) {
    case "invalid": {
      return "We couldn't find that den";
    }
    case "expired": {
      // Verbatim from the product owner: the tone ("seems to be", "us") is the
      // point. A screen that tells somebody they were wrong about their own
      // link is the failure this state exists to stop.
      return "This den seems to be hiding from us";
    }
    case "full": {
      return "This den is full";
    }
    case "banned": {
      return "You can't rejoin this den";
    }
    case "already-member": {
      return "You're already in this den";
    }
    default: {
      return "Join this den?";
    }
  }
}

export function denJoinDescription(outcome: DenJoinOutcome): string {
  if (outcome.kind === "invalid") {
    return "This link is cut short, mistyped, or points to a den that's gone. Check it and try again.";
  }
  const { name } = outcome.den;
  if (outcome.kind === "expired") {
    return name
      ? `${name} is still here, but the code in this link has been replaced.`
      : "This den is still here, but the code in this link has been replaced.";
  }
  if (!name) {
    return "This den has no name yet.";
  }
  if (outcome.kind === "full") {
    return `${name} already has ${DEN_MEMBERS_MAX} members, which is as many as a den can hold.`;
  }
  if (outcome.kind === "banned") {
    return "This account is blocked from rejoining. If that's a mistake, ask an owner or Elder to unban you.";
  }
  return outcome.kind === "already-member"
    ? `Open ${name} to carry on.`
    : `You'll join ${name}.`;
}

// The label on the button that commits (or opens, for a member). Full,
// invalid, expired and banned get nothing to press: expired acts through the
// owner and the way out, which the screen draws itself.
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

export interface DenJoinFailureCopy {
  actionLabel: string | null;
  description: string;
  title: string;
}

// The words for a refused join. Mirrors the web `DenJoinFailureScreen` copy
// so a refusal whose words are wrong is still a wrong refusal.
export function denJoinFailureCopy(reason: DenJoinFailure): DenJoinFailureCopy {
  switch (reason) {
    case "banned": {
      return {
        actionLabel: "Back to messages",
        description:
          "This account is blocked from rejoining. If that's a mistake, ask an owner or Elder to unban you.",
        title: "You can't rejoin this den",
      };
    }
    case "needs-messages": {
      return {
        actionLabel: "Enable Messages",
        description:
          "Joining a den needs a Messages key so you can read it. Opening Messages sets one up automatically — it takes a moment, once.",
        title: "Turn on Messages first",
      };
    }
    case "rate-limited": {
      return {
        actionLabel: null,
        description:
          "You are joining dens too quickly. Wait a moment and try this link again.",
        title: "Too many joins just now",
      };
    }
    case "invalid": {
      const outcome = { kind: "invalid", reason: "unknown-code" } as const;
      return {
        actionLabel: "Nevermind",
        description: denJoinDescription(outcome),
        title: denJoinTitle(outcome),
      };
    }
    default: {
      return {
        actionLabel: "Go to messages",
        description:
          "That didn't come back from the server. Try again in a moment.",
        title: "Couldn't check this link",
      };
    }
  }
}

// How long an invite link still has, in the coarsest honest unit. Past is
// clamped to zero rather than painting a negative number on clock skew.
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
  return `Expires in ${Math.floor(hours / 24)}d`;
}

export function denInviteIsExpired(
  inviteExpiresAt: Date | null,
  now: Date
): boolean {
  return inviteExpiresAt !== null && inviteExpiresAt.getTime() <= now.getTime();
}
