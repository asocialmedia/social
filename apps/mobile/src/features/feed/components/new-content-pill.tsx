// New-content pill: floats over the feed when the head probe finds posts
// newer than the list (web NewContentPill). Overlapping avatar stack (first
// three), "{count} new post(s)", ArrowUp. Tapping reveals them at the top.
import { Image } from "expo-image";
import { ArrowUp } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";

import avatarPlaceholder from "@/assets/images/avatar-placeholder.png";
import { getApiBaseUrl } from "@/lib/api-env";
import { SURFACE_SHADOWS, SURFACE_SHADOWS_DARK, useAppTheme } from "@/theme";

import { resolveProfileImageUrl } from "../../home/components/profile-utils";

export interface PillAuthor {
  avatarUrl?: string | null;
  id: string;
  username?: string | null;
}

interface NewContentPillProps {
  authors: PillAuthor[];
  count: number;
  onPress: () => void;
}

export function NewContentPill({
  authors,
  count,
  onPress,
}: NewContentPillProps) {
  const { isDark, theme } = useAppTheme();
  if (count <= 0) {
    return null;
  }
  const apiBase = getApiBaseUrl();
  const label = count === 1 ? "1 new post" : `${count} new posts`;
  return (
    <View pointerEvents="box-none" style={styles.float}>
      <Pressable
        accessibilityLabel={`Show ${label}`}
        accessibilityRole="button"
        onPress={onPress}
      >
        {({ pressed }) => (
          <View
            style={[
              styles.pill,
              {
                backgroundColor: theme.cardBg,
                borderColor: theme.cardBorder,
                boxShadow: isDark ? SURFACE_SHADOWS_DARK : SURFACE_SHADOWS,
              },
              pressed && styles.pressed,
            ]}
          >
            <View style={styles.stack}>
              {authors.slice(0, 3).map((author, index) => {
                const uri = author.avatarUrl
                  ? resolveProfileImageUrl(author.avatarUrl, apiBase)
                  : null;
                return (
                  <Image
                    contentFit="cover"
                    key={author.id}
                    source={uri ? { uri } : avatarPlaceholder}
                    style={[
                      styles.stackAvatar,
                      { borderColor: theme.cardBg },
                      index === 0 && styles.stackFirst,
                    ]}
                  />
                );
              })}
            </View>
            <Text style={[styles.label, { color: theme.inputText }]}>
              {label}
            </Text>
            <ArrowUp color={theme.inputText} size={16} />
          </View>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  float: {
    alignItems: "center",
    left: 0,
    position: "absolute",
    right: 0,
    top: 12,
    zIndex: 5,
  },
  label: {
    fontFamily: "SofiaProMed",
    fontSize: 14,
    fontWeight: "normal",
  },
  pill: {
    alignItems: "center",
    borderRadius: 9999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  pressed: {
    opacity: 0.85,
  },
  stack: {
    flexDirection: "row",
  },
  stackAvatar: {
    borderRadius: 9999,
    borderWidth: 2,
    height: 24,
    marginLeft: -8,
    width: 24,
  },
  stackFirst: {
    marginLeft: 0,
  },
});
