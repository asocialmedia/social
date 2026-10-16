import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { CommunityAvatar } from "@/features/communities/components/community-avatar";
import { groupCommunityRoleItems } from "@/features/home/components/profile-utils";
import type {
  CommunityRoleBadgeType,
  CommunityRoleLike,
} from "@/features/home/components/profile-utils";
import { UserBadge } from "@/features/home/components/user-badge";
import { useAppTheme } from "@/theme";

const ROLE_LABEL: Record<CommunityRoleBadgeType, string> = {
  MEMBER: "Member of",
  MODERATOR: "Moderator of",
  OWNER: "Owner of",
};

export function ProfileCommunityRoles({
  roles,
}: {
  roles: readonly CommunityRoleLike[];
}) {
  const router = useRouter();
  const { theme } = useAppTheme();
  const groups = groupCommunityRoleItems(roles);
  if (groups.length === 0) {
    return null;
  }
  return (
    <View style={styles.groups}>
      {groups.map(({ communities, role }) => (
        <View key={role} style={styles.row}>
          <UserBadge
            communityRoles={communities.map((community) => ({
              community,
              role,
            }))}
          />
          <View style={styles.communities}>
            <Text style={[styles.label, { color: theme.dividerText }]}>
              {ROLE_LABEL[role]}
            </Text>
            {communities.slice(0, 2).map((community, index) => (
              <View key={community.slug} style={styles.community}>
                {index > 0 ? (
                  <Text style={[styles.label, { color: theme.dividerText }]}>
                    {communities.length > 2 ? "," : "&"}
                  </Text>
                ) : null}
                <Pressable
                  accessibilityLabel={`Open a/${community.slug}`}
                  accessibilityRole="link"
                  onPress={() =>
                    router.push({
                      params: { slug: community.slug },
                      pathname: "/a/[slug]",
                    })
                  }
                  style={styles.link}
                >
                  <CommunityAvatar
                    community={{
                      accentColor: community.accentColor ?? "ember",
                      avatarUrl: community.avatarUrl ?? null,
                      name: community.name ?? community.slug,
                      slug: community.slug,
                    }}
                    size={18}
                  />
                  <Text
                    numberOfLines={1}
                    style={[styles.slug, { color: theme.inputText }]}
                  >
                    a/{community.slug}
                  </Text>
                </Pressable>
              </View>
            ))}
            {communities.length > 2 ? (
              <Text style={[styles.label, { color: theme.dividerText }]}>
                & {communities.length - 2} more
              </Text>
            ) : null}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  communities: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 5,
    minWidth: 0,
  },
  community: {
    alignItems: "center",
    flexDirection: "row",
    gap: 5,
    maxWidth: "100%",
  },
  groups: { gap: 6, marginTop: 10 },
  label: { fontFamily: "SofiaProReg", fontSize: 13, lineHeight: 20 },
  link: {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 1,
    gap: 5,
    minWidth: 0,
  },
  row: { alignItems: "flex-start", flexDirection: "row", gap: 8 },
  slug: { flexShrink: 1, fontFamily: "SofiaProMed", fontSize: 13 },
});
