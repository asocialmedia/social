import { Image } from "expo-image";
import { useRouter } from "expo-router";
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
import { DialogPanel } from "@/components/surface/dialog-panel";
import { CommunityAvatar } from "@/features/communities/components/community-avatar";
import { getApiBaseUrl } from "@/lib/network/api-env";
import {
  PROFILE_STATS_SHADOWS,
  PROFILE_STATS_SHADOWS_DARK,
  useAppTheme,
} from "@/theme";

import { getBadgePanelItems, rankBadges } from "./profile-utils";
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
  apiBase,
  community,
  onPress,
}: {
  apiBase: string;
  community: Extract<BadgePanelItem, { kind: "role" }>["communities"][number];
  onPress: () => void;
}) {
  const { theme } = useAppTheme();
  return (
    <Pressable
      accessibilityLabel={`Open a/${community.slug}`}
      accessibilityRole="link"
      onPress={(event) => {
        event.stopPropagation();
        onPress();
      }}
      style={styles.communityRow}
    >
      <CommunityAvatar
        apiBase={apiBase}
        community={{
          accentColor: community.accentColor ?? "ember",
          avatarUrl: community.avatarUrl ?? null,
          name: community.name ?? community.slug,
          slug: community.slug,
        }}
        size={20}
      />
      <Text
        numberOfLines={1}
        style={[styles.communitySlug, { color: theme.inputText }]}
      >
        a/{community.slug}
      </Text>
    </Pressable>
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
  onCommunityPress,
}: {
  apiBase: string;
  item: Extract<BadgePanelItem, { kind: "role" }>;
  onCommunityPress: (slug: string) => void;
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
                apiBase={apiBase}
                community={community}
                onPress={() => onCommunityPress(community.slug)}
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
  onCommunityPress,
}: {
  apiBase: string;
  badge?: string | null;
  badges?: (string | null)[] | null;
  communityRoles?: readonly CommunityRoleLike[] | null;
  onCommunityPress?: (slug: string) => void;
}) {
  const { isDark, theme } = useAppTheme();
  const router = useRouter();
  const openCommunity =
    onCommunityPress ??
    ((slug: string) =>
      router.push({ params: { slug }, pathname: "/a/[slug]" }));
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
          <RolePanelRow
            apiBase={apiBase}
            item={item}
            key={item.type}
            onCommunityPress={openCommunity}
          />
        )
      )}
    </View>
  );
}

interface UserBadgeProps {
  badge?: string | null;
  badges?: (string | null)[] | null;
  communityRoles?: readonly CommunityRoleLike[] | null;
  // Renders the rail at the profile header's larger size instead of the
  // in-feed default. See BADGE_RAIL_SIZE_LARGE.
  large?: boolean;
  onToggle?: () => void;
  open?: boolean;
}

// Web's profile header renders the badge larger than everywhere else (h-8
// w-24, i.e. 32x96) by passing a className override; its default rail stays
// h-5 w-15. This mirrors that split: the rail keeps the 20x60 default and the
// profile header opts up, rather than every badge in the app growing.
const BADGE_RAIL_SIZE = { height: 20, width: 60 } as const;
const BADGE_RAIL_SIZE_LARGE = { height: 32, width: 96 } as const;

export function UserBadge({
  badge,
  badges,
  communityRoles,
  large = false,
  onToggle,
  open = false,
}: UserBadgeProps) {
  const { theme } = useAppTheme();
  const router = useRouter();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const expanded = onToggle ? open : detailsOpen;
  const ranked = rankBadges(badge, badges, communityRoles);
  const [primary, ...rest] = ranked;
  if (!primary) {
    return null;
  }
  const source =
    primary.kind === "platform"
      ? PLATFORM_BADGE_ART[primary.type]
      : ROLE_BADGE_ART[primary.type];
  const railSize = large ? BADGE_RAIL_SIZE_LARGE : BADGE_RAIL_SIZE;
  const rail = (
    <View style={styles.rail}>
      <Image
        accessibilityLabel=""
        contentFit="contain"
        source={source}
        style={[styles.banner, railSize]}
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
  return (
    <>
      <Pressable
        accessibilityLabel={expanded ? "Hide badges" : "Show all badges"}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        hitSlop={4}
        onPress={(event) => {
          event.stopPropagation();
          if (onToggle) {
            onToggle();
          } else {
            setDetailsOpen(true);
          }
        }}
      >
        {rail}
      </Pressable>
      {!onToggle && detailsOpen ? (
        <DialogPanel
          description="Account badges and community roles."
          onClose={() => setDetailsOpen(false)}
          title="Badges"
        >
          <BadgePanel
            apiBase={getApiBaseUrl()}
            badge={badge}
            badges={badges}
            communityRoles={communityRoles}
            onCommunityPress={(slug) => {
              setDetailsOpen(false);
              router.push({ params: { slug }, pathname: "/a/[slug]" });
            }}
          />
        </DialogPanel>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  banner: {
    height: 20,
    width: 60,
  },
  communityRow: {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 1,
    gap: 6,
    maxWidth: "100%",
  },
  communitySlug: {
    flexShrink: 1,
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
    maxWidth: "100%",
  },
  separator: {
    fontFamily: "SofiaProReg",
    fontSize: 12,
    fontWeight: "normal",
    marginRight: 6,
  },
});
