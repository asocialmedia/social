import { profileMutualLabel } from "@asm/ui/lib/profile-mutuals";
import type { UserListMutual } from "@asm/ui/lib/user-list";
import { Text, View } from "react-native";

import { UserAvatar } from "@/components/avatar/user-avatar";
import { useAppTheme } from "@/theme";

export function ProfileMutualAvatars({
  kind,
  users,
  total,
}: {
  kind: "followers" | "following";
  users: readonly UserListMutual[] | undefined;
  total?: number;
}) {
  const { theme } = useAppTheme();
  const visible = users?.slice(0, 3) ?? [];
  if (!visible.length) {
    return null;
  }
  const count = total ?? users?.length ?? 0;
  const remaining = Math.max(0, count - visible.length);
  return (
    <View
      accessible
      accessibilityLabel={profileMutualLabel(kind, visible, count)}
      accessibilityRole="image"
      style={{ alignItems: "center", flexDirection: "row", flexShrink: 0 }}
    >
      {visible.map((user, index) => (
        <View
          key={user.id}
          style={{
            borderColor: theme.containerBg,
            borderRadius: 7,
            borderWidth: 1,
            marginLeft: index ? -9 : 0,
            zIndex: visible.length - index,
          }}
        >
          <UserAvatar
            radius={6}
            size={18}
            url={user.avatarUrl}
            userId={user.id}
            username={user.username}
          />
        </View>
      ))}
      {remaining ? (
        <Text
          style={{
            color: theme.dividerText,
            fontFamily: "SofiaProMed",
            fontSize: 12,
            marginLeft: 3,
          }}
        >
          +{remaining}
        </Text>
      ) : null}
    </View>
  );
}
