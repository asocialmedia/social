import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Flame, Sparkles, Users } from "lucide-react-native";
import { useState } from "react";
import type { ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { UserAvatar } from "@/components/avatar/user-avatar";
import { Gradient3D } from "@/components/surface/gradient-3d";
import { UserBadge } from "@/features/home/components/user-badge";
import { getApiBaseUrl } from "@/lib/api-env";
import {
  FOLLOW_BUTTON_SHADOWS,
  FOLLOW_BUTTON_SHADOWS_LIGHT,
  HIGHLIGHT_SHADOWS,
  HIGHLIGHT_SHADOWS_DARK,
  SURFACE_SHADOWS,
  SURFACE_SHADOWS_DARK,
  useAppTheme,
} from "@/theme";

import type { ExploreUser } from "../lib/explore-api";
import {
  AVATAR_CORNER,
  AVATAR_OVERLAP,
  AVATAR_RING_ALIGN_SELF,
  AVATAR_SIZE,
  RING_BORDER,
  RING_RADIUS,
} from "./explore-user-card-geometry";

function bannerFor(
  avatarUrl: string | null | undefined,
  apiBase: string
): string | null {
  if (!avatarUrl) {
    return null;
  }
  return avatarUrl.startsWith("http") ? avatarUrl : `${apiBase}${avatarUrl}`;
}

function followLabel(pending: boolean, following: boolean): string {
  if (pending) {
    return "…";
  }
  return following ? "Following" : "Follow";
}

export function ExploreUserCard({
  canFollow,
  highlight = false,
  onFollow,
  onPress,
  reason,
  user,
}: {
  canFollow: boolean;
  highlight?: boolean;
  onFollow: (next: boolean) => Promise<void>;
  onPress: () => void;
  reason?: string;
  user: ExploreUser;
}) {
  const { isDark, theme } = useAppTheme();
  const [following, setFollowing] = useState(user.isFollowing);
  const [pending, setPending] = useState(false);
  const [bannerFailed, setBannerFailed] = useState(false);
  const apiBase = getApiBaseUrl();
  const bannerUrl = bannerFor(user.bannerUrl, apiBase);
  const avatarUrl = bannerFor(user.avatarUrl, apiBase);
  const hasBanner = Boolean(bannerUrl) && !bannerFailed;
  const resolvedReason = reason ?? user.reason ?? user.reasons?.[0];
  let cardBackground = theme.cardBg;
  let { cardBorder } = theme;
  let cardShadow = isDark ? SURFACE_SHADOWS_DARK : SURFACE_SHADOWS;
  let avatarRing = theme.containerBg;
  if (highlight) {
    if (isDark) {
      cardBackground = "#3a1a0c";
      cardBorder = "rgba(251, 146, 60, 0.16)";
      cardShadow = HIGHLIGHT_SHADOWS_DARK;
      avatarRing = "#3a1a0c";
    } else {
      cardBackground = "#ffedd5";
      cardBorder = "rgba(234, 88, 12, 0.18)";
      cardShadow = HIGHLIGHT_SHADOWS;
      avatarRing = "#ffedd5";
    }
  }
  const followShadows = isDark
    ? FOLLOW_BUTTON_SHADOWS
    : FOLLOW_BUTTON_SHADOWS_LIGHT;
  let bannerContent: ReactNode;
  if (hasBanner && bannerUrl) {
    bannerContent = (
      <Image
        cachePolicy="memory-disk"
        contentFit="cover"
        onError={() => setBannerFailed(true)}
        source={{ uri: bannerUrl }}
        style={styles.bannerImage}
      />
    );
  } else if (avatarUrl) {
    bannerContent = (
      <Image
        blurRadius={Platform.OS === "android" ? 14 : 20}
        cachePolicy="memory-disk"
        contentFit="cover"
        source={{ uri: avatarUrl }}
        style={[styles.bannerImage, styles.bannerFallbackImage]}
      />
    );
  } else {
    bannerContent = (
      <LinearGradient
        colors={["rgba(249, 115, 22, 0.42)", "rgba(230, 85, 0, 0.2)"]}
        end={{ x: 1, y: 1 }}
        start={{ x: 0, y: 0 }}
        style={StyleSheet.absoluteFill}
      />
    );
  }

  const handleFollow = () => {
    if (pending) {
      return;
    }
    setPending(true);
    const next = !following;
    setFollowing(next);
    void (async () => {
      try {
        await onFollow(next);
      } catch {
        setFollowing(!next);
      }
      setPending(false);
    })();
  };

  return (
    <Pressable
      accessibilityLabel={`Open ${user.displayName ?? user.username}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: cardBackground,
          borderColor: cardBorder,
          boxShadow: cardShadow,
          opacity: pressed ? 0.88 : 1,
        },
      ]}
    >
      <View style={[styles.banner, { backgroundColor: theme.dividerLine }]}>
        {bannerContent}
        <LinearGradient
          colors={["rgba(249, 115, 22, 0.35)", "transparent"]}
          end={{ x: 1, y: 0.5 }}
          start={{ x: 0, y: 0.5 }}
          style={StyleSheet.absoluteFill}
        />
        <LinearGradient
          colors={["transparent", theme.containerBg]}
          end={{ x: 0.5, y: 1 }}
          start={{ x: 0.5, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
        {highlight ? (
          <View style={styles.recommended}>
            <Sparkles color="#f97316" fill="#f97316" size={11} />
            <Text style={styles.recommendedText}>Recommended</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.content}>
        <View
          style={[
            styles.avatarOverlap,
            {
              borderColor: avatarRing,
              borderRadius: RING_RADIUS,
              borderWidth: RING_BORDER,
            },
          ]}
        >
          <UserAvatar
            radius={AVATAR_CORNER}
            size={AVATAR_SIZE}
            url={user.avatarUrl}
          />
        </View>
        <View style={styles.nameRow}>
          <Text
            numberOfLines={1}
            style={[styles.name, { color: theme.inputText }]}
          >
            {user.displayName ?? user.username}
          </Text>
          <UserBadge
            badge={user.badge}
            badges={user.badges}
            communityRoles={user.communityMemberships}
          />
        </View>
        <Text
          numberOfLines={1}
          style={[styles.username, { color: theme.dividerText }]}
        >
          @{user.username}
        </Text>
        {user.bio ? (
          <Text
            numberOfLines={2}
            style={[styles.bio, { color: theme.dividerText }]}
          >
            {user.bio}
          </Text>
        ) : null}
        {resolvedReason ? (
          <Text style={[styles.reason, { color: theme.dividerText }]}>
            {resolvedReason}
          </Text>
        ) : null}
        <View style={styles.metrics}>
          <View style={styles.metric}>
            <Users color={theme.dividerText} size={14} />
            <Text style={[styles.metricStrong, { color: theme.inputText }]}>
              {user._count.followers.toLocaleString()}
            </Text>
            <Text style={[styles.metricLabel, { color: theme.dividerText }]}>
              followers
            </Text>
          </View>
          <View style={styles.metric}>
            <Flame color="#ff9500" fill="#ff9500" size={14} />
            <Text style={[styles.metricStrong, { color: theme.inputText }]}>
              {(user.aura ?? 0).toLocaleString()}
            </Text>
            <Text style={[styles.metricLabel, { color: theme.dividerText }]}>
              aura
            </Text>
          </View>
        </View>
        {canFollow ? (
          <Pressable
            accessibilityLabel={
              following
                ? `Unfollow ${user.username}`
                : `Follow ${user.username}`
            }
            accessibilityRole="button"
            disabled={pending}
            onPress={(event) => {
              event.stopPropagation();
              handleFollow();
            }}
            style={({ pressed }) => [
              styles.follow,
              { opacity: pressed ? 0.88 : 1 },
            ]}
          >
            <Gradient3D
              colors={["#ff9500", "#e65500"]}
              radius={9999}
              shadows={followShadows}
              style={styles.followSurface}
            >
              <Text style={styles.followText}>
                {followLabel(pending, following)}
              </Text>
            </Gradient3D>
          </Pressable>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  avatarOverlap: {
    alignSelf: AVATAR_RING_ALIGN_SELF,
    marginTop: AVATAR_OVERLAP,
    zIndex: 2,
  },
  banner: {
    height: 80,
    overflow: "hidden",
    position: "relative",
    width: "100%",
  },
  bannerFallbackImage: {
    opacity: 0.68,
    transform: [{ scale: 1.15 }],
  },
  bannerImage: { height: "100%", width: "100%" },
  bio: {
    fontFamily: "SofiaProReg",
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  card: {
    borderCurve: "continuous",
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 16,
    overflow: "hidden",
    width: "100%",
  },
  content: { flex: 1, padding: 12, paddingTop: 0 },
  follow: {
    alignItems: "center",
    marginTop: 12,
    width: "100%",
  },
  followSurface: {
    alignItems: "center",
    borderRadius: 9999,
    justifyContent: "center",
    minHeight: 32,
    paddingHorizontal: 12,
    width: "100%",
  },
  followText: {
    color: "#ffffff",
    fontFamily: "SofiaProBold",
    fontSize: 12,
  },
  metric: { alignItems: "center", flexDirection: "row", gap: 4 },
  metricLabel: { fontFamily: "SofiaProReg", fontSize: 12 },
  metricStrong: { fontFamily: "SofiaProMed", fontSize: 12 },
  metrics: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    marginTop: 8,
  },
  name: {
    flexShrink: 1,
    fontFamily: "SofiaProBold",
    fontSize: 15,
    minWidth: 0,
  },
  nameRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
    marginTop: 8,
    maxWidth: "100%",
  },
  reason: { fontFamily: "SofiaProReg", fontSize: 11, marginTop: 6 },
  recommended: {
    alignItems: "center",
    backgroundColor: "rgba(249,115,22,0.2)",
    borderColor: "rgba(249,115,22,0.4)",
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 4,
    left: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
    position: "absolute",
    top: 10,
  },
  recommendedText: {
    color: "#f97316",
    fontFamily: "SofiaProMed",
    fontSize: 10,
  },
  username: { fontFamily: "SofiaProReg", fontSize: 12, marginTop: 2 },
});
