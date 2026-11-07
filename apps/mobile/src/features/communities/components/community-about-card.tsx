// Native port of web CommunityAboutCard
// (components/communities/page/community-about-card.tsx). Web shows it in
// the xl right rail; a phone has no rail, so the community screen renders it
// under the header for communities whose content the reader can see.
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Flame } from "lucide-react-native";
import { StyleSheet, Text, View } from "react-native";

import { getAuraFlameStyle } from "@/features/home/components/profile-utils";
import { formatNumber } from "@/lib/format/format-number";
import { getApiBaseUrl } from "@/lib/network/api-env";
import { useAppTheme } from "@/theme";

import type { CommunityDetail } from "../lib/communities-api";
import { communityMediaUrl } from "../lib/community-page-cache";
import { CommunityAvatar } from "./community-avatar";

// date-fns "MMMM d, yyyy", e.g. "March 4, 2026". Empty for a bad timestamp.
export function formatCommunityCreatedDate(iso: string): string {
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) {
    return "";
  }
  return new Date(time).toLocaleDateString("en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function AboutStat({ label, value }: { label: string; value: number }) {
  const { theme } = useAppTheme();
  return (
    <View style={styles.stat}>
      <Text
        numberOfLines={1}
        style={[styles.statLabel, { color: theme.dividerText }]}
      >
        {label}
      </Text>
      <Text style={[styles.statValue, { color: theme.inputText }]}>
        {formatNumber(value)}
      </Text>
    </View>
  );
}

export function CommunityAboutCard({
  detail,
}: {
  detail: Pick<CommunityDetail, "community" | "stats">;
}) {
  const { isDark, theme } = useAppTheme();
  const { community, stats } = detail;
  const banner = communityMediaUrl(community.bannerUrl, getApiBaseUrl());
  const flame = getAuraFlameStyle(stats.communityAura);
  const created = formatCommunityCreatedDate(community.createdAt);
  return (
    <View
      accessibilityLabel={`About ${community.name}`}
      style={[
        styles.card,
        {
          backgroundColor: theme.cardBg,
          borderColor: theme.cardBorder,
          boxShadow: isDark
            ? "inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 1px 2px rgba(0, 0, 0, 0.3)"
            : "inset 0 1px 0 rgba(255, 255, 255, 0.8), 0 1px 2px rgba(0, 0, 0, 0.05)",
        },
      ]}
    >
      {banner ? (
        // Web's RowBannerWash kept to the top 30% band.
        <View pointerEvents="none" style={styles.wash}>
          <Image
            contentFit="cover"
            source={{ uri: banner }}
            style={[StyleSheet.absoluteFill, styles.washImage]}
          />
          <LinearGradient
            colors={["transparent", theme.cardBg]}
            style={StyleSheet.absoluteFill}
          />
        </View>
      ) : null}
      <View style={styles.body}>
        <View style={styles.identity}>
          <CommunityAvatar community={community} size={44} />
          <View style={styles.identityText}>
            <View style={styles.nameRow}>
              <Text
                numberOfLines={1}
                style={[styles.name, { color: theme.inputText }]}
              >
                {community.name}
              </Text>
              {community.mature ? (
                <View
                  style={[
                    styles.matureChip,
                    {
                      backgroundColor: isDark ? "#2a2a2a" : "#ececec",
                    },
                  ]}
                >
                  <Text style={[styles.matureText, { color: theme.inputText }]}>
                    18+
                  </Text>
                </View>
              ) : null}
            </View>
            <Text
              numberOfLines={1}
              style={[styles.slug, { color: theme.dividerText }]}
            >
              a/{community.slug}
            </Text>
          </View>
          <View
            accessibilityLabel={`${formatNumber(stats.communityAura)} community aura`}
            style={styles.aura}
          >
            <Flame
              color={flame.color}
              fill={flame.filled ? flame.color : "transparent"}
              size={14}
            />
            <Text style={[styles.auraValue, { color: theme.inputText }]}>
              {formatNumber(stats.communityAura)}
            </Text>
          </View>
        </View>
        {community.description ? (
          <Text style={[styles.description, { color: theme.dividerText }]}>
            {community.description}
          </Text>
        ) : null}
        <View style={styles.stats}>
          <AboutStat label="Members" value={stats.members} />
          <AboutStat label="Weekly visitors" value={stats.weeklyVisitors} />
        </View>
        {created ? (
          <Text style={[styles.created, { color: theme.dividerText }]}>
            Created {created}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  aura: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
    paddingTop: 2,
  },
  auraValue: {
    fontFamily: "SofiaProBold",
    fontSize: 14,
    fontVariant: ["tabular-nums"],
  },
  body: { padding: 16 },
  card: {
    borderCurve: "continuous",
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 12,
    marginHorizontal: 16,
    overflow: "hidden",
  },
  created: { fontFamily: "SofiaProReg", fontSize: 12, marginTop: 16 },
  description: {
    fontFamily: "SofiaProReg",
    fontSize: 14,
    lineHeight: 23,
    marginTop: 12,
  },
  identity: { alignItems: "flex-start", flexDirection: "row", gap: 12 },
  identityText: { flex: 1, minWidth: 0, paddingTop: 2 },
  matureChip: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  matureText: { fontFamily: "SofiaProBold", fontSize: 10 },
  name: { flexShrink: 1, fontFamily: "SofiaProBold", fontSize: 14 },
  nameRow: { alignItems: "center", flexDirection: "row", gap: 6 },
  slug: { fontFamily: "SofiaProReg", fontSize: 12 },
  stat: { flex: 1, minWidth: 0 },
  statLabel: { fontFamily: "SofiaProReg", fontSize: 11 },
  statValue: {
    fontFamily: "SofiaProBold",
    fontSize: 18,
    fontVariant: ["tabular-nums"],
    lineHeight: 20,
    marginTop: 2,
  },
  stats: { columnGap: 16, flexDirection: "row", marginTop: 16 },
  wash: {
    height: "30%",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  washImage: { opacity: 0.35 },
});
