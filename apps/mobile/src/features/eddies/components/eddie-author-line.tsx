import { Text, View } from "react-native";

import { BlueskyIcon } from "@/features/feed/components/bluesky-icon";
import type { FeedComment } from "@/features/feed/lib/feed-api";
import { UserBadge } from "@/features/home/components/user-badge";
import { useAppTheme } from "@/theme";

export function EddieAuthorLine({
  name,
  username,
  date,
  bluesky,
  deleted,
  user,
  onOpenAuthor,
}: {
  name: string;
  username: string;
  date: string;
  bluesky: boolean;
  deleted: boolean;
  user: FeedComment["user"];
  onOpenAuthor: () => void;
}) {
  const { theme } = useAppTheme();
  const metadata = {
    color: theme.dividerText,
    fontFamily: "SofiaProReg",
    fontSize: 14,
    lineHeight: 20,
  };
  return (
    <View className="min-w-0 flex-1 flex-row items-center gap-2">
      {deleted ? (
        <Text style={metadata}>[deleted]</Text>
      ) : (
        <>
          <Text
            accessibilityRole="link"
            onPress={onOpenAuthor}
            numberOfLines={1}
            style={{
              color: theme.inputText,
              flexShrink: 0,
              fontFamily: "SofiaProBold",
              fontSize: 14,
              lineHeight: 20,
              maxWidth: "55%",
            }}
          >
            {name}
          </Text>
          {bluesky ? (
            <View className="shrink-0">
              <BlueskyIcon size={14} />
            </View>
          ) : (
            <UserBadge
              badge={user?.badge}
              badges={user?.badges}
              communityRoles={user?.communityMemberships}
            />
          )}
          <Text
            accessibilityRole="link"
            accessibilityLabel={`Open @${username}'s profile`}
            onPress={onOpenAuthor}
            numberOfLines={1}
            style={[metadata, { flexShrink: 1, minWidth: 0 }]}
          >
            @{username}
          </Text>
        </>
      )}
      <Text style={[metadata, { flexShrink: 0 }]}>·</Text>
      <Text style={[metadata, { flexShrink: 0 }]}>{date}</Text>
    </View>
  );
}
