// Who the online friends strip shows, ported from
// apps/web/src/components/messages/online-friends-strip.tsx. The strip shows
// exactly who is online among the people the reader follows; everyone else
// (idle, or not following / follow-unknown) stays out. Pure so the filter is
// unit-tested apart from the strip that renders it.
import type { PresenceUser } from "./client";

export function selectOnlineFriends(
  users: readonly PresenceUser[]
): PresenceUser[] {
  return users.filter(
    (person) => person.status === "online" && person.isFollowing
  );
}
