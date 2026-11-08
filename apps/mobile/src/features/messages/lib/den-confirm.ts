// What the product says about a den ban and the other den confirmations.
// Ported from apps/web/src/lib/messages/den-ban-copy.ts (ban wording) and the
// denConfirmCopy half of apps/web/src/lib/messages/den-permissions.ts.
//
// The dialogs that draw these are entangled with the session and the roster
// query and never render in a test; the wording is the part that drifts, so it
// lives here where it is asserted directly. Never describe encryption as E2EE
// in this copy: dens use the same server-recoverable encryption as DMs.

// The word. "Ban" rather than "block": a block already means something
// specific and irreversible elsewhere in the product, and a manager choosing
// between the two would read "block" as the bigger hammer. Banning is scoped
// to one den and one press undoes it.
export const DEN_BAN_TERM = "Banned";

// The confirmation for a ban. Says what happens immediately, what survives,
// and what it takes to change its mind, in that order.
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

// The confirmation for lifting a ban. Unbanning restores eligibility, not
// membership.
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

// What a ban row says underneath the name, in priority order: the reason wins
// when there is one, the author is the fallback, and a ban with neither still
// says who did what via the term.
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

// The collapsed banned section's own line. It has to say that these people
// cannot come back, or a manager reads it as a mute list.
export const DEN_BANS_EMPTY = "No banned members.";
export const DEN_BANS_SUMMARY = "Blocked accounts can't rejoin until unbanned.";

// The confirmation copy for a den action a person has to agree to. Says what
// is lost and who keeps what, so the four paths cannot drift apart in tone.
export type DenConfirmKind =
  | "ban-member"
  | "delete-den"
  | "leave-den"
  | "remove-member"
  | "transfer-ownership"
  | "unban-member";

export function denConfirmCopy(input: {
  kind: DenConfirmKind;
  memberName?: string | null;
}): { confirmLabel: string; description: string; title: string } {
  if (input.kind === "remove-member") {
    const name = input.memberName?.trim() || "This person";
    return {
      confirmLabel: `Remove ${name}`,
      description: `${name} loses access to this den immediately. Everything they have already read stays on their device, and they can't read anything sent from now on.`,
      title: `Remove ${name}?`,
    };
  }
  if (input.kind === "ban-member") {
    return denBanConfirmCopy(input.memberName);
  }
  if (input.kind === "unban-member") {
    return denUnbanConfirmCopy(input.memberName);
  }
  if (input.kind === "leave-den") {
    return {
      confirmLabel: "Leave den",
      description:
        "You'll stop getting messages from this den. If you are the owner, it passes to the longest-standing member.",
      title: "Leave this den?",
    };
  }
  if (input.kind === "transfer-ownership") {
    const name = input.memberName?.trim() || "This person";
    return {
      confirmLabel: `Hand over to ${name}`,
      description: `${name} becomes the owner of this den and can remove you from it, rename it, or delete it. You'll stay in as an Elder, so you can still add and remove members.`,
      title: `Hand this den to ${name}?`,
    };
  }
  return {
    confirmLabel: "Delete den",
    description:
      "The den, its messages and its history are deleted for everyone. This cannot be undone.",
    title: "Delete this den?",
  };
}
