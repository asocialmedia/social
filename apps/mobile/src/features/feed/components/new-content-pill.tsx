// New-content pill: floats over the feed when the head probe finds posts
// newer than the list (web NewContentPill). Overlapping avatar stack (first
// three), "{count} new post(s)", ArrowUp. Tapping reveals them at the top.
// The surface is web's `.rail-3d-btn` dark glass in both themes: a smoky
// fill, white ink, the bright inner lip and the dark outer ring. Native has no
// backdrop blur here, so the fill carries the glass alone; pressing shows
// web's `:hover` recipe.
import { Image } from "expo-image";
import { ArrowUp } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";

import avatarPlaceholder from "@/assets/images/avatar-placeholder.png";
import { RAIL_BUTTON } from "@/components/surface/recipes";
import { getApiBaseUrl } from "@/lib/network/api-env";
import { useAppTheme } from "@/theme";

import {
  bskyAvatarForSize,
  resolveAvatarWithFallback,
} from "../../home/components/profile-utils";
import { newContentLabel } from "../lib/new-content-label";

const RAIL_PRESSED = {
  background: "rgba(40, 44, 54, 0.6)",
  color: "#ffffff",
  shadows:
    "inset 0 0 0 1px rgba(255, 255, 255, 0.35), inset 0 1.5px 2px rgba(255, 255, 255, 0.25), 0 0 0 1px rgba(0, 0, 0, 0.4), 0 1px 2px rgba(0, 0, 0, 0.3), 0 4px 10px rgba(0, 0, 0, 0.3)",
} as const;

export interface PillAuthor {
  avatarUrl?: string | null;
  id: string;
  username?: string | null;
}

export interface NewContentPillProps {
  authors: PillAuthor[];
  count: number;
  floating?: boolean;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}

// Web renders these avatars through UserAvatar (seeded default fallback,
// placeholder only after a real load error). The native pill matches that:
// every author resolves to a displayable uri, and a failed fetch swaps that
// tile to the placeholder instead of going blank.
function PillAvatar({
  apiBase,
  author,
  index,
}: {
  apiBase: string;
  author: PillAuthor;
  index: number;
}) {
  const { theme } = useAppTheme();
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const uri = bskyAvatarForSize(
    resolveAvatarWithFallback(author.avatarUrl, apiBase, author.id),
    24
  );
  const failed = failedUri === uri;
  return (
    <Image
      cachePolicy="memory-disk"
      contentFit="cover"
      recyclingKey={uri}
      onError={() => setFailedUri(uri)}
      source={failed ? avatarPlaceholder : { uri }}
      style={[
        styles.stackAvatar,
        { borderColor: theme.backgroundAlt },
        index === 0 && styles.stackFirst,
      ]}
    />
  );
}

export function NewContentPill({
  authors,
  count,
  floating = true,
  onPress,
  style,
}: NewContentPillProps) {
  if (count <= 0) {
    return null;
  }
  const apiBase = getApiBaseUrl();
  const label = newContentLabel(count);
  return (
    <View
      pointerEvents="box-none"
      style={[floating ? styles.float : styles.inline, style]}
    >
      <Pressable
        accessibilityLabel={`Show ${label}`}
        accessibilityRole="button"
        onPress={onPress}
      >
        {({ pressed }) => {
          const recipe = pressed ? RAIL_PRESSED : RAIL_BUTTON;
          return (
            <View
              style={[
                styles.pill,
                {
                  backgroundColor: recipe.background,
                  boxShadow: recipe.shadows,
                },
              ]}
            >
              <View style={styles.stack}>
                {authors.slice(0, 3).map((author, index) => (
                  <PillAvatar
                    apiBase={apiBase}
                    author={author}
                    index={index}
                    key={author.id}
                  />
                ))}
              </View>
              <Text style={[styles.label, { color: recipe.color }]}>
                {label}
              </Text>
              <ArrowUp color={recipe.color} size={16} />
            </View>
          );
        }}
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
  inline: {
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    fontFamily: "SofiaProMed",
    fontSize: 14,
    fontWeight: "normal",
  },
  pill: {
    alignItems: "center",
    borderCurve: "continuous",
    borderRadius: 9999,
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
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
