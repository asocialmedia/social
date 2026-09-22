// Badge rail + dropdown panel for the profile popup. The rail mirrors web's
// static rail (top banner 60x20, extras behind a "+N" chip); tapping it
// toggles the panel web shows on click: every badge with its title and
// description, and each community role with its communities. Community and
// profile screens do not exist on mobile yet, so community rows are static
// (same as the popup's other disabled stubs).
import { Image } from "expo-image";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import authorBadge from "@/assets/images/roles/author.png";
import devBadge from "@/assets/images/roles/dev.png";
import earlyBadge from "@/assets/images/roles/early.png";
import memberRoleBadge from "@/assets/images/roles/member.png";
import modRoleBadge from "@/assets/images/roles/mod.png";
import ownerRoleBadge from "@/assets/images/roles/owner.png";
import shitposterBadge from "@/assets/images/roles/shitposter.png";
import trendingBadge from "@/assets/images/roles/trending.png";
import { logWarn } from "@/lib/telemetry";
import {
  PROFILE_STATS_SHADOWS,
  PROFILE_STATS_SHADOWS_DARK,
  useAppTheme,
} from "@/theme";

import {
  getBadgePanelItems,
  rankBadges,
  resolveProfileImageUrl,
} from "./profile-utils";
import type {
  BadgePanelItem,
  CommunityRoleBadgeType,
  CommunityRoleLike,
  PlatformBadgeType,
} from "./profile-utils";

// Same art files as web (apps/web/assets/roles), copied into the native
// asset catalog so Metro bundles them.
const PLATFORM_BADGE_ART: Record<PlatformBadgeType, number> = {
  author: authorBadge,
  dev: devBadge,
  early: earlyBadge,
  shitposter: shitposterBadge,
  trending: trendingBadge,
};

const ROLE_BADGE_ART: Record<CommunityRoleBadgeType, number> = {
  MEMBER: memberRoleBadge,
  MODERATOR: modRoleBadge,
  OWNER: ownerRoleBadge,
};

function badgeArt(item: BadgePanelItem): number {
  return item.kind === "platform"
    ? PLATFORM_BADGE_ART[item.type]
    : ROLE_BADGE_ART[item.type];
}

function CommunityMark({
  accentColor,
  apiBase,
  avatarUrl,
  slug,
}: {
  accentColor?: string | null;
  apiBase: string;
  avatarUrl?: string | null;
  slug: string;
}) {
  const { theme } = useAppTheme();
  const [failed, setFailed] = useState(false);
  const uri = avatarUrl ? resolveProfileImageUrl(avatarUrl, apiBase) : null;
  return (
    <View style={styles.communityRow}>
      <View
        style={[
          styles.communityAvatar,
          {
            backgroundColor: accentColor ?? theme.dividerLine,
          },
        ]}
      >
        <Text style={styles.communityInitial}>
          {(slug[0] ?? "a").toUpperCase()}
        </Text>
        {uri && !failed ? (
          <Image
            contentFit="cover"
            onError={() => {
              logWarn("profile.community_avatar_failed", {});
              setFailed(true);
            }}
            source={{ uri }}
            style={styles.communityImage}
          />
        ) : null}
      </View>
      <Text style={[styles.communitySlug, { color: theme.inputText }]}>
        a/{slug}
      </Text>
    </View>
  );
}

function PanelRow({ item }: { item: BadgePanelItem }) {
  const { theme } = useAppTheme();
  return (
    <View style={styles.panelRow}>
      <Image
        accessibilityLabel=""
        contentFit="contain"
        source={badgeArt(item)}
        style={styles.panelBanner}
      />
      <View style={styles.panelCopy}>
        <Text style={[styles.panelTitle, { color: theme.inputText }]}>
          {item.title}
        </Text>
        <Text style={[styles.panelDesc, { color: theme.dividerText }]}>
          {item.description}
        </Text>
      </View>
    </View>
  );
}

function RolePanelRow({
  apiBase,
  item,
}: {
  apiBase: string;
  item: Extract<BadgePanelItem, { kind: "role" }>;
}) {
  const { theme } = useAppTheme();
  return (
    <View style={styles.panelRow}>
      <Image
        accessibilityLabel=""
        contentFit="contain"
        source={badgeArt(item)}
        style={styles.panelBanner}
      />
      <View style={styles.panelCopy}>
        <Text style={[styles.panelTitle, { color: theme.inputText }]}>
          {item.title} of
        </Text>
        <Text style={[styles.panelDesc, { color: theme.dividerText }]}>
          {item.description}
        </Text>
        <View style={styles.roleCommunities}>
          {item.communities.map((community, index) => (
            <View key={community.slug} style={styles.roleCommunity}>
              {index > 0 ? (
                <Text style={[styles.separator, { color: theme.dividerText }]}>
                  {index === item.communities.length - 1 ? "&" : ","}
                </Text>
              ) : null}
              <CommunityMark
                accentColor={community.accentColor}
                apiBase={apiBase}
                avatarUrl={community.avatarUrl}
                slug={community.slug}
              />
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

export function BadgePanel({
  apiBase,
  badge,
  badges,
  communityRoles,
}: {
  apiBase: string;
  badge?: string | null;
  badges?: (string | null)[] | null;
  communityRoles?: readonly CommunityRoleLike[] | null;
}) {
  const { isDark, theme } = useAppTheme();
  const items = getBadgePanelItems(badge, badges, communityRoles);
  if (items.length === 0) {
    return null;
  }
  return (
    <View
      style={[
        styles.panel,
        {
          backgroundColor: theme.containerBg,
          borderColor: theme.cardBorder,
          boxShadow: isDark
            ? PROFILE_STATS_SHADOWS_DARK
            : PROFILE_STATS_SHADOWS,
        },
      ]}
    >
      {items.map((item) =>
        item.kind === "platform" ? (
          <PanelRow item={item} key={item.type} />
        ) : (
          <RolePanelRow apiBase={apiBase} item={item} key={item.type} />
        )
      )}
    </View>
  );
}

interface UserBadgeProps {
  badge?: string | null;
  badges?: (string | null)[] | null;
  communityRoles?: readonly CommunityRoleLike[] | null;
  onToggle?: () => void;
  open?: boolean;
}

export function UserBadge({
  badge,
  badges,
  communityRoles,
  onToggle,
  open = false,
}: UserBadgeProps) {
  const { theme } = useAppTheme();
  const ranked = rankBadges(badge, badges, communityRoles);
  const [primary, ...rest] = ranked;
  if (!primary) {
    return null;
  }
  const source =
    primary.kind === "platform"
      ? PLATFORM_BADGE_ART[primary.type]
      : ROLE_BADGE_ART[primary.type];
  const rail = (
    <View style={styles.rail}>
      <Image
        accessibilityLabel=""
        contentFit="contain"
        source={source}
        style={styles.banner}
      />
      {rest.length > 0 ? (
        <View style={[styles.moreChip, { backgroundColor: theme.dividerLine }]}>
          <Text style={[styles.moreText, { color: theme.dividerText }]}>
            +{rest.length}
          </Text>
        </View>
      ) : null}
    </View>
  );
  if (!onToggle) {
    return rail;
  }
  return (
    <Pressable
      accessibilityLabel={open ? "Hide badges" : "Show all badges"}
      accessibilityRole="button"
      onPress={onToggle}
    >
      {rail}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    height: 20,
    width: 60,
  },
  communityAvatar: {
    alignItems: "center",
    borderRadius: 9999,
    height: 20,
    justifyContent: "center",
    overflow: "hidden",
    width: 20,
  },
  communityImage: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  communityInitial: {
    color: "#ffffff",
    fontFamily: "SofiaProBold",
    fontSize: 10,
    fontWeight: "normal",
  },
  communityRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
  },
  communitySlug: {
    fontFamily: "SofiaProMed",
    fontSize: 12,
    fontWeight: "normal",
  },
  moreChip: {
    alignItems: "center",
    borderRadius: 9999,
    height: 16,
    justifyContent: "center",
    minWidth: 16,
    paddingHorizontal: 4,
  },
  moreText: {
    fontFamily: "SofiaProMed",
    fontSize: 10,
    fontWeight: "normal",
    lineHeight: 12,
  },
  panel: {
    borderRadius: 14,
    borderWidth: 1,
    gap: 4,
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  panelBanner: {
    height: 20,
    marginTop: 2,
    width: 60,
  },
  panelCopy: {
    flex: 1,
    minWidth: 0,
  },
  panelDesc: {
    fontFamily: "SofiaProReg",
    fontSize: 11,
    fontWeight: "normal",
    lineHeight: 14,
  },
  panelRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 10,
    paddingVertical: 4,
  },
  panelTitle: {
    fontFamily: "SofiaProBold",
    fontSize: 12,
    fontWeight: "normal",
  },
  rail: {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 0,
    gap: 4,
  },
  roleCommunities: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 4,
  },
  roleCommunity: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
  },
  separator: {
    fontFamily: "SofiaProReg",
    fontSize: 12,
    fontWeight: "normal",
    marginRight: 6,
  },
});
