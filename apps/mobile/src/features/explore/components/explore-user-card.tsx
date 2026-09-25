import { Image } from "expo-image";
import { Flame, Sparkles, UserPlus, Users } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { UserAvatar } from "@/components/avatar/user-avatar";
import { getApiBaseUrl } from "@/lib/api-env";
import { SURFACE_SHADOWS, SURFACE_SHADOWS_DARK, useAppTheme } from "@/theme";

import type { ExploreUser } from "../lib/explore-api";

function bannerFor(avatarUrl: string | null, apiBase: string): string | null {
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
  const apiBase = getApiBaseUrl();
  const bannerUrl = bannerFor(user.bannerUrl ?? user.avatarUrl, apiBase);
  const resolvedReason = reason ?? user.reason ?? user.reasons?.[0];

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
          backgroundColor: theme.cardBg,
          borderColor: theme.cardBorder,
          boxShadow: isDark ? SURFACE_SHADOWS_DARK : SURFACE_SHADOWS,
          opacity: pressed ? 0.88 : 1,
        },
      ]}
    >
      <View style={[styles.banner, { backgroundColor: theme.dividerLine }]}>
        {bannerUrl ? (
          <Image
            contentFit="cover"
            source={{ uri: bannerUrl }}
            style={styles.bannerImage}
          />
        ) : null}
        {highlight ? (
          <View style={styles.recommended}>
            <Sparkles color="#f97316" fill="#f97316" size={11} />
            <Text style={styles.recommendedText}>Recommended</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.content}>
        <View
          style={[styles.avatarOverlap, { borderColor: theme.containerBg }]}
        >
          <UserAvatar size={56} url={user.avatarUrl} />
        </View>
        <Text
          numberOfLines={1}
          style={[styles.name, { color: theme.inputText }]}
        >
          {user.displayName ?? user.username}
        </Text>
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
              following && styles.following,
              pressed && styles.pressed,
            ]}
          >
            <UserPlus
              color={following ? theme.inputText : "#ffffff"}
              size={14}
            />
            <Text
              style={[
                styles.followText,
                { color: following ? theme.inputText : "#ffffff" },
              ]}
            >
              {followLabel(pending, following)}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  avatarOverlap: {
    borderRadius: 24,
    borderWidth: 4,
    marginTop: -28,
    zIndex: 2,
  },
  banner: {
    height: 80,
    overflow: "hidden",
    position: "relative",
    width: "100%",
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
  },
  content: { padding: 12, paddingTop: 0 },
  follow: {
    alignItems: "center",
    backgroundColor: "#f97316",
    borderRadius: 8,
    flexDirection: "row",
    gap: 5,
    justifyContent: "center",
    marginTop: 12,
    minHeight: 32,
    paddingHorizontal: 11,
  },
  followText: { fontFamily: "SofiaProMed", fontSize: 12 },
  following: { backgroundColor: "rgba(128,128,128,0.2)" },
  metric: { alignItems: "center", flexDirection: "row", gap: 4 },
  metricLabel: { fontFamily: "SofiaProReg", fontSize: 12 },
  metricStrong: { fontFamily: "SofiaProMed", fontSize: 12 },
  metrics: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    marginTop: 8,
  },
  name: { fontFamily: "SofiaProBold", fontSize: 15, marginTop: 8 },
  pressed: { opacity: 0.65 },
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
