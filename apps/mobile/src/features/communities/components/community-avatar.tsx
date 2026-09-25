import { Image } from "expo-image";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { resolveProfileImageUrl } from "@/features/home/components/profile-utils";
import { getApiBaseUrl } from "@/lib/api-env";
import { useAppTheme } from "@/theme";

import type { CommunityData } from "../lib/communities-api";

export function CommunityAvatar({
  community,
  size = 48,
}: {
  community: Pick<CommunityData, "accentColor" | "avatarUrl" | "name" | "slug">;
  size?: number;
}) {
  const { theme } = useAppTheme();
  const [failed, setFailed] = useState(false);
  const accent = community.accentColor ?? "#f97316";
  const uri = resolveProfileImageUrl(community.avatarUrl, getApiBaseUrl());
  return (
    <View
      style={[
        styles.avatar,
        {
          backgroundColor: failed || !uri ? `${accent}33` : theme.cardBg,
          borderColor: accent,
          height: size,
          width: size,
        },
      ]}
    >
      {uri && !failed ? (
        <Image
          accessibilityLabel={`${community.name} community`}
          cachePolicy="memory-disk"
          contentFit="cover"
          onError={() => setFailed(true)}
          source={{ uri }}
          style={styles.image}
        />
      ) : (
        <Text style={[styles.initial, { color: accent }]}>
          {(community.name[0] ?? "a").toUpperCase()}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    alignItems: "center",
    borderCurve: "continuous",
    borderRadius: 12,
    borderWidth: 2,
    justifyContent: "center",
    overflow: "hidden",
  },
  image: { height: "100%", width: "100%" },
  initial: { fontFamily: "SofiaProBold", fontSize: 18 },
});
