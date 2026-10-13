import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { resolveCommunityAccentColor } from "@/features/communities/lib/community-accents";
import { useAppTheme } from "@/theme";

export function CommunityAttribution({
  accentColor,
  reason,
  slug,
}: {
  accentColor?: string | null;
  reason: boolean;
  slug: string;
}) {
  const { theme, isDark } = useAppTheme();
  const router = useRouter();
  const resolvedColor = resolveCommunityAccentColor(accentColor, isDark);
  return (
    <Pressable
      accessibilityLabel={`Community a/${slug}`}
      accessibilityRole="link"
      onPress={(event) => {
        event.stopPropagation();
        router.push({ params: { slug }, pathname: "/a/[slug]" });
      }}
      style={styles.attribution}
    >
      <View
        style={[styles.attributionBar, { backgroundColor: resolvedColor }]}
      />
      <Text
        numberOfLines={1}
        style={[styles.attributionText, { color: theme.dividerText }]}
      >
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
  attributionBar: {
    borderRadius: 9999,
    height: 14,
    width: 2,
  },
  attributionText: {
    flex: 1,
    fontFamily: "SofiaProMed",
    fontSize: 12,
    fontWeight: "normal",
    minWidth: 0,
  },
});
