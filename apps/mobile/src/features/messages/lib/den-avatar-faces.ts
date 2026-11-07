// Which member faces a den's collage avatar draws, and in what order.
// Ported from apps/web/src/lib/messages/den-label.ts (denAvatarFaces).
//
// All members (including the viewer) ordered by role then roster order, so the
// owner's face leads. The cap is a layout decision (four overlapping squircles
// stop reading as a group) rather than a membership one; the roster itself is a
// separate read. The drawing lives in components/den-avatar.tsx; this only
// decides the order.
export interface DenAvatarFaceMember {
  role?: string | null;
}

// Default cap matches web. The collage passes 4 explicitly; the tile draws the
// fourth slot as the +N tally when the den holds more than four.
export const DEN_AVATAR_FACES_MAX = 3;

const ROLE_ORDER: Record<string, number> = {
  ADMIN: 1,
  MEMBER: 2,
  OWNER: 0,
};

export function denAvatarFaces<T extends DenAvatarFaceMember>(
  members: readonly T[],
  _myUserId?: string,
  limit: number = DEN_AVATAR_FACES_MAX
): T[] {
  return members
    .map((member, index) => ({ index, member }))
    .toSorted((left, right) => {
      const rank =
        (ROLE_ORDER[left.member.role ?? "MEMBER"] ?? 2) -
        (ROLE_ORDER[right.member.role ?? "MEMBER"] ?? 2);
      // The original index breaks ties so two members of the same role keep the
      // order the server sent, which is join order.
      if (rank !== 0) {
        return rank;
      }
      return left.index - right.index;
    })
    .slice(0, Math.max(0, limit))
    .map(({ member }) => member);
}
