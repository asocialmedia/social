"use client";

import { useMemo } from "react";

import UserAvatar from "@/components/layouts/user/user-avatar";
import type { PresenceUser } from "@/lib/messages/client";

export function OnlineFriendsStrip({
  creating,
  onSelect,
  users,
}: {
  creating: string | null;
  onSelect: (userId: string) => void;
  users: readonly PresenceUser[];
}) {
  const online = useMemo(
    () =>
      users.filter(
        (person) => person.status === "online" && person.isFollowing
      ),
    [users]
  );
  if (online.length === 0) {
    return null;
  }

  return (
    <ul
      aria-label="Online people you follow"
      className="hide-native-scrollbar flex shrink-0 gap-3 overflow-x-auto overscroll-x-contain px-2.5 py-2 md:hidden"
    >
      {online.map((person) => (
        <li className="shrink-0" key={person.id}>
          <button
            aria-busy={creating === person.id}
            aria-label={`Message ${person.displayName} (@${person.username}), online`}
            className="relative flex size-12 cursor-pointer items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60"
            disabled={creating !== null}
            onClick={() => onSelect(person.id)}
            title={`${person.displayName} · Online`}
            type="button"
          >
            <UserAvatar
              avatarUrl={person.avatarUrl}
              className="rounded-full!"
              size={48}
            />
            <span
              aria-hidden
              className="border-background absolute right-0 bottom-0 size-3 rounded-full border-2 bg-green-500"
            />
          </button>
        </li>
      ))}
    </ul>
  );
}
