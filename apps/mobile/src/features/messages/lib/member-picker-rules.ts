// Selection rules for the den member picker, ported from
// apps/web/src/components/messages/member-picker.tsx and
// apps/web/src/lib/messages/den-capacity.ts.
//
// The refusal sentences mirror the server vocabulary (`GROUP_ADD_REFUSAL_COPY`
// and `DEN_BAN_PICKER_REFUSAL` on web) word for word, and the ceiling mirrors
// `DEN_LIMITS` (100 members max, 2 min). They are restated here rather than
// imported because mobile client modules never import `@asm/db` (it pulls the
// Prisma runtime), and the server re-checks every rule under its claim lock.
// The tests below assert the exact strings so a reword on either side surfaces
// as a failure rather than silent drift.

import type { GroupAddRefusal, SearchUserResult } from "./client";

// The reader-facing wording for a group-add refusal, in the picker's
// second-person row voice: the row is about the person who would be added.
export const GROUP_ADD_REFUSAL_COPY: Record<GroupAddRefusal, string> = {
  NOT_FOLLOWING_YOU: "only lets people they follow add them",
  NO_DIRECT_ADDS: "doesn't allow being added to groups",
};

// Why a banned person cannot be picked. Shown rather than hidden: somebody the
// reader is specifically trying to invite who turns out to be banned was
// found, and an empty result would say nothing about why.
export const DEN_BAN_PICKER_REFUSAL = "banned from this den";

// The den member ceiling, as the client sees it. The service re-checks under
// its claim lock; the picker honours it so it cannot propose a roster the
// server will refuse.
export const DEN_MEMBERS_MAX = 100;
export const DEN_MEMBERS_MIN = 2;

// How many more people a den being created can take. The creator is already
// in, so the room is the ceiling less one.
export function denCreateRoom(): number {
  return Math.max(0, DEN_MEMBERS_MAX - 1);
}

// How many more people a den that already holds `currentMembers` can take.
// Zero means full.
export function denAddRoom(currentMembers: number): number {
  return Math.max(0, DEN_MEMBERS_MAX - currentMembers);
}

// How many more people the reader must pick before a create is worth sending.
export function denCreateNeedsOthers(): number {
  return Math.max(0, DEN_MEMBERS_MIN - 1);
}

export interface PickerPerson {
  addRefusal?: GroupAddRefusal | null;
  avatarUrl: string | null;
  displayName: string;
  hasIdentity: boolean;
  id: string;
  username: string;
}

export function toPickerPerson(result: SearchUserResult): PickerPerson {
  return {
    addRefusal: result.addRefusal ?? null,
    avatarUrl: result.avatarUrl,
    displayName: result.displayName,
    hasIdentity: result.hasIdentity,
    id: result.id,
    username: result.username,
  };
}

export interface PickerRowState {
  disabled: boolean;
  // Why the row is dead, when being dead is not the reader's fault. Null rows
  // render no reason.
  reason: string | null;
}

// Whether one picker row can be picked. Reasons apply in web's order: a ban
// first (a decision somebody else made about them, and the only one no action
// of the reader's will clear), then no message identity, then the person's
// own group-add setting, then the ceiling (unselected rows go dead, picked
// rows stay live so they can be put back).
export function pickerRowState(input: {
  addRefusal?: GroupAddRefusal | null;
  atCeiling: boolean;
  banned: boolean;
  hasIdentity: boolean;
  isSelected: boolean;
}): PickerRowState {
  let reason: string | null = null;
  if (input.banned) {
    reason = DEN_BAN_PICKER_REFUSAL;
  } else if (input.hasIdentity === false) {
    reason = "hasn't enabled Messages";
  } else if (input.addRefusal !== null && input.addRefusal !== undefined) {
    reason = GROUP_ADD_REFUSAL_COPY[input.addRefusal];
  }
  if (reason === null && input.atCeiling && !input.isSelected) {
    return { disabled: true, reason: null };
  }
  return { disabled: reason !== null, reason };
}

// Peers only, deduplicated across conversations: somebody in three chats is
// one row, not three. Excluded ids (self, current members) are filtered out,
// never greyed: the reader is not looking for them. Capped so a long history
// does not become a long list.
export function dedupePickerCandidates(
  people: readonly PickerPerson[],
  excludeIds: ReadonlySet<string>,
  cap: number
): PickerPerson[] {
  const seen = new Set<string>();
  const rows: PickerPerson[] = [];
  for (const person of people) {
    if (excludeIds.has(person.id) || seen.has(person.id)) {
      continue;
    }
    seen.add(person.id);
    rows.push(person);
    if (rows.length >= cap) {
      return rows;
    }
  }
  return rows;
}
