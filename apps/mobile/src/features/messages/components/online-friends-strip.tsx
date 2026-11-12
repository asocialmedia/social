// The horizontal strip of online people you follow, ported from
// apps/web/src/components/messages/online-friends-strip.tsx (an `md:hidden`
// strip on web: it IS the mobile spec). Filters to `online` + following,
// renders nothing when empty, disables everything while a conversation is
// being created, and marks the in-flight row busy.
import { useMemo } from "react";
import { Pressable, ScrollView } from "react-native";

import { UserAvatar } from "@/components/avatar/user-avatar";
import type { PresenceUser } from "@/features/messages/lib/client";
import { selectOnlineFriends } from "@/features/messages/lib/online-friends";

import { MessagePresenceIndicator } from "./message-presence-indicator";

export function OnlineFriendsStrip({
  creating,
  onSelect,
  users,
}: {
  creating: string | null;
  onSelect: (userId: string) => void;
  users: readonly PresenceUser[];
}) {
  const online = useMemo(() => selectOnlineFriends(users), [users]);
  if (online.length === 0) {
    return null;
  }
  const busy = creating !== null;
  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      accessibilityLabel="Online people you follow"
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{
        gap: 12,
        paddingHorizontal: 10,
        paddingVertical: 8,
      }}
    >
      {online.map((person) => (
        <Pressable
          accessibilityLabel={`Message ${person.displayName} (@${person.username}), online`}
          accessibilityRole="button"
          accessibilityState={{
            busy: creating === person.id,
            disabled: busy,
          }}
          disabled={busy}
          key={person.id}
          onPress={() => onSelect(person.id)}
          style={{ opacity: busy ? 0.6 : 1 }}
        >
          <UserAvatar size={48} url={person.avatarUrl} userId={person.id} />
          <MessagePresenceIndicator
            status="online"
            testID="online-friend-presence"
          />
        </Pressable>
      ))}
    </ScrollView>
  );
}
