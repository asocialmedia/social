import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text } from "react-native";

import { CommunityAvatar } from "@/features/communities/components/community-avatar";
import { getApiBaseUrl } from "@/lib/network/api-env";
import { useAppTheme } from "@/theme";

export function CommunityAttribution({
  accentColor,
  id,
  name,
  reason,
  slug,
}: {
  accentColor?: string | null;
  id?: string;
  name?: string;
  reason: boolean;
  slug: string;
}) {
  const { theme } = useAppTheme();
  const router = useRouter();
  return (
    <Pressable
      accessibilityLabel={`Shared via a/${slug}`}
      accessibilityRole="link"
      onPress={(event) => {
        event.stopPropagation();
        router.push({ params: { slug }, pathname: "/a/[slug]" });
      }}
      style={styles.attribution}
    >
      <CommunityAvatar
        community={{
          accentColor: accentColor ?? null,
          avatarUrl: id
            ? `${getApiBaseUrl()}/api/communities/avatar/${encodeURIComponent(id)}/image`
            : null,
          name: name ?? slug,
          slug,
        }}
        size={22}
      />
      <Text
        numberOfLines={1}
        style={[styles.attributionText, { color: theme.dividerText }]}
      >
        {"Shared via "}
        <Text style={{ color: theme.inputText, fontFamily: "SofiaProMed" }}>
          a/{slug}
        </Text>
        {reason ? (
          <Text style={{ color: theme.dividerText, fontFamily: "SofiaProReg" }}>
            {" · "}Trending in a/{slug}
          </Text>
        ) : null}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  attribution: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    marginBottom: 10,
  },
  attributionText: {
    flex: 1,
    fontFamily: "SofiaProMed",
    fontSize: 12,
    fontWeight: "normal",
    minWidth: 0,
  },
});
