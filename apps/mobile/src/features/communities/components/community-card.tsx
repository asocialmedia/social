import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { ArrowUpRight, Flame, LayoutGrid, Users } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { resolveProfileImageUrl } from "@/features/home/components/profile-utils";
import { getApiBaseUrl } from "@/lib/api-env";
import { useAppTheme } from "@/theme";

import type { CommunityData } from "../lib/communities-api";
import { CommunityAvatar } from "./community-avatar";

function formatNumber(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1).replace(".0", "")}M`;
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1).replace(".0", "")}k`;
  }
  return value.toLocaleString();
}

function formatAge(createdAt: string): string {
  const elapsed = Date.now() - new Date(createdAt).getTime();
  const day = 24 * 60 * 60 * 1000;
  if (!Number.isFinite(elapsed) || elapsed < day) {
    return "Created recently";
  }
  const days = Math.floor(elapsed / day);
  if (days < 30) {
    return `Created ${days} day${days === 1 ? "" : "s"} ago`;
  }
  const months = Math.floor(days / 30);
  if (months < 12) {
    return `Created ${months} month${months === 1 ? "" : "s"} ago`;
  }
  const years = Math.floor(days / 365);
  return `Created ${years} year${years === 1 ? "" : "s"} ago`;
}

export function CommunityCard({
  aura = 0,
  community,
  onPress,
  width,
}: {
  aura?: number;
  community: CommunityData;
  onPress: () => void;
  width?: number;
}) {
  const { theme } = useAppTheme();
  const [bannerFailed, setBannerFailed] = useState(false);
  const bannerUri = resolveProfileImageUrl(
    community.bannerUrl,
    getApiBaseUrl()
  );
  return (
    <Pressable
      accessibilityLabel={`Open ${community.name}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: theme.cardBg,
          borderColor: theme.cardBorder,
          opacity: pressed ? 0.88 : 1,
          width,
        },
      ]}
    >
      <View
        style={[
          styles.banner,
          { backgroundColor: `${community.accentColor ?? "#f97316"}33` },
        ]}
      >
        {bannerUri && !bannerFailed ? (
          <Image
            cachePolicy="memory-disk"
            contentFit="cover"
            onError={() => setBannerFailed(true)}
            source={{ uri: bannerUri }}
            style={styles.bannerImage}
          />
        ) : null}
        <LinearGradient
          colors={["transparent", theme.containerBg]}
          style={styles.bannerFade}
        />
        {community.mature ? (
          <View
            style={[
              styles.mature,
              { backgroundColor: theme.cardBg, borderColor: theme.cardBorder },
            ]}
          >
            <Text style={[styles.matureText, { color: theme.inputText }]}>
              18+
            </Text>
          </View>
        ) : null}
      </View>
      <View style={styles.body}>
        <View style={styles.avatarOverlap}>
          <CommunityAvatar community={community} size={56} />
        </View>
        <View style={styles.identityRow}>
          <View style={styles.identity}>
            <Text
              numberOfLines={1}
              style={[styles.name, { color: theme.inputText }]}
            >
              {community.name}
            </Text>
            <Text
              numberOfLines={1}
              style={[styles.slug, { color: theme.dividerText }]}
            >
              a/{community.slug}
            </Text>
          </View>
          <ArrowUpRight color={theme.dividerText} opacity={0} size={17} />
        </View>
        <Text
          numberOfLines={2}
          style={[styles.description, { color: theme.dividerText }]}
        >
          {community.description}
        </Text>
        <View style={[styles.stats, { borderTopColor: theme.cardBorder }]}>
          <Stat
            icon={<Flame color="#ff9500" fill="#ff9500" size={14} />}
            value={formatNumber(aura)}
          />
          <Stat
            icon={<Users color="#f97316" fill="#f97316" size={14} />}
            value={formatNumber(community._count.members)}
          />
          <Stat
            icon={<LayoutGrid color="#f97316" fill="#f97316" size={14} />}
            value={formatNumber(community._count.posts)}
          />
          <Text
            numberOfLines={1}
            style={[styles.age, { color: theme.dividerText }]}
          >
            {formatAge(community.createdAt)}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

function Stat({ icon, value }: { icon: React.ReactNode; value: string }) {
  const { theme } = useAppTheme();
  return (
    <View style={styles.stat}>
      {icon}
      <Text style={[styles.statValue, { color: theme.inputText }]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  age: { fontFamily: "SofiaProReg", fontSize: 10, marginLeft: "auto" },
  avatarOverlap: { marginTop: -32, zIndex: 2 },
  banner: {
    height: 112,
    overflow: "hidden",
    position: "relative",
    width: "100%",
  },
  bannerFade: {
    bottom: 0,
    height: 64,
    left: 0,
    position: "absolute",
    right: 0,
  },
  bannerImage: { height: "100%", width: "100%" },
  body: { padding: 16, paddingTop: 0 },
  card: {
    borderCurve: "continuous",
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
  },
  description: {
    fontFamily: "SofiaProReg",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 8,
    minHeight: 38,
  },
  identity: { flex: 1, minWidth: 0 },
  identityRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 6,
    marginTop: 12,
  },
  mature: {
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
    position: "absolute",
    right: 12,
    top: 12,
  },
  matureText: { fontFamily: "SofiaProMed", fontSize: 10 },
  name: { fontFamily: "SofiaProBold", fontSize: 18 },
  slug: { fontFamily: "SofiaProReg", fontSize: 12, marginTop: 2 },
  stat: { alignItems: "center", flexDirection: "row", gap: 4 },
  statValue: { fontFamily: "SofiaProMed", fontSize: 12 },
  stats: {
    alignItems: "center",
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 14,
    marginTop: 14,
    paddingTop: 12,
  },
});
