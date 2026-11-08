// New-content pill: floats over the feed when the head probe finds posts
// newer than the list (web NewContentPill). Overlapping avatar stack (first
// three), "{count} new post(s)", ArrowUp. Tapping reveals them at the top.
import { Image } from "expo-image";
import { ArrowUp } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";

import avatarPlaceholder from "@/assets/images/avatar-placeholder.png";
import { getApiBaseUrl } from "@/lib/network/api-env";
import { SURFACE_SHADOWS, SURFACE_SHADOWS_DARK, useAppTheme } from "@/theme";

import {
  bskyAvatarForSize,
  resolveAvatarWithFallback,
} from "../../home/components/profile-utils";
import { newContentLabel } from "../lib/new-content-label";

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
        { borderColor: theme.cardBg },
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
  const { isDark, theme } = useAppTheme();
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
              {authors.slice(0, 3).map((author, index) => (
                <PillAvatar
                  apiBase={apiBase}
                  author={author}
                  index={index}
                  key={author.id}
                />
              ))}
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
