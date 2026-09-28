import { FontAwesome6 } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import {
  CalendarDays,
  Flame,
  Globe,
  MessageCircle,
  Pencil,
  Share2,
  UserPlus,
} from "lucide-react-native";
import { useCallback } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { UserAvatar } from "@/components/avatar/user-avatar";
import { BioContent } from "@/features/home/components/bio-content";
import {
  formatJoinedDate,
  formatNumber,
  getAuraFlameStyle,
  getSocialLinks,
  resolveProfileImageUrl,
  safeSocialUrl,
} from "@/features/home/components/profile-utils";
import { UserBadge } from "@/features/home/components/user-badge";
import { getApiBaseUrl } from "@/lib/api-env";
import {
  BTN_3D_GRAY_SHADOWS,
  BTN_3D_GRAY_SHADOWS_DARK,
  EDIT_PROFILE_SHADOWS,
  EDIT_PROFILE_SHADOWS_DARK,
  FOLLOW_BUTTON_SHADOWS,
  FOLLOW_BUTTON_SHADOWS_LIGHT,
  ICON_BUTTON_SHADOWS_DARK,
  ICON_BUTTON_SHADOWS_LIGHT,
  useAppTheme,
} from "@/theme";

import type { ProfileHeaderProfile } from "../lib/profile-view-model";

function BannerContent({
  avatar,
  banner,
}: {
  avatar: string | null;
  banner: string | null;
}) {
  if (banner) {
    return (
      <Image
        contentFit="cover"
        source={{ uri: banner }}
        style={styles.banner}
      />
    );
  }
  if (avatar) {
    return (
      <Image
        blurRadius={10}
        contentFit="cover"
        source={{ uri: avatar }}
        style={[styles.banner, styles.blurred]}
      />
    );
  }
  return (
    <LinearGradient
      colors={["#ff9500", "#e65500", "#8b2f00"]}
      end={{ x: 1, y: 1 }}
      start={{ x: 0, y: 0 }}
      style={styles.banner}
    />
  );
}

function SocialIcon({ color, kind }: { color: string; kind: string }) {
  if (kind === "website") {
    return <Globe color={color} size={16} />;
  }
  const names: Record<string, "github" | "linkedin" | "reddit" | "x-twitter"> =
    {
      github: "github",
      linkedin: "linkedin",
      reddit: "reddit",
      twitter: "x-twitter",
    };
  const name = names[kind];
  return name ? <FontAwesome6 color={color} name={name} size={15} /> : null;
}

function getFollowButtonStyles(isFollowing: boolean, isDark: boolean) {
  if (isFollowing) {
    return {
      colors: isDark
        ? (["#4a4a4a", "#333333"] as const)
        : (["#f7f8fa", "#e4e7ec"] as const),
      shadow: isDark ? BTN_3D_GRAY_SHADOWS_DARK : BTN_3D_GRAY_SHADOWS,
      textColor: isDark ? "#ffffff" : "#1f2430",
    };
  }
  return {
    colors: ["#ff9500", "#e65500"] as const,
    shadow: isDark ? FOLLOW_BUTTON_SHADOWS : FOLLOW_BUTTON_SHADOWS_LIGHT,
    textColor: "#ffffff",
  };
}

export function ProfileHeader({
  canMessage,
  canFollow,
  isFollowing,
  isOwnProfile,
  onEdit,
  onFollow,
  onMessage,
  onShare,
  profile,
}: {
  canFollow: boolean;
  canMessage: boolean;
  isFollowing: boolean;
  isOwnProfile: boolean;
  onEdit: () => void;
  onFollow: () => void;
  onMessage: () => void;
  onShare: () => void;
  profile: ProfileHeaderProfile;
}) {
  const { theme, isDark } = useAppTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const apiBase = getApiBaseUrl();
  const banner = resolveProfileImageUrl(profile.bannerUrl, apiBase);
  const avatar = resolveProfileImageUrl(profile.avatarUrl, apiBase);
  const socials = getSocialLinks(profile);
  const flame = getAuraFlameStyle(profile.aura);
  const joined = formatJoinedDate(profile.createdAt);
  const role = profile.communityMemberships?.[0];
  const followStyles = getFollowButtonStyles(isFollowing, isDark);
  const openSocial = useCallback(async (href: string) => {
    try {
      await Linking.openURL(href);
    } catch {
      // Linking can reject when the OS has no handler for the profile's host.
    }
  }, []);

  return (
    <View style={styles.root}>
      <View style={[styles.bannerWrap, { height: 140 + insets.top }]}>
        <BannerContent avatar={avatar} banner={banner} />
        <LinearGradient
          colors={["transparent", theme.containerBg]}
          end={{ x: 0.5, y: 1 }}
          pointerEvents="none"
          start={{ x: 0.5, y: 0.45 }}
          style={styles.bannerFade}
        />
      </View>
      <View style={styles.content}>
        <View style={styles.avatarRow}>
          <View
            style={[styles.avatarOverlap, { borderColor: theme.containerBg }]}
          >
            <UserAvatar
              radius={16}
              seed={profile.username || profile.id}
              size={112}
              url={profile.avatarUrl}
              userId={profile.id}
              username={profile.username}
            />
          </View>
          <View style={styles.actions}>
            {isOwnProfile ? (
              <Pressable
                accessibilityLabel="Edit profile"
                accessibilityRole="button"
                onPress={onEdit}
                style={({ pressed }) => [
                  styles.editButton,
                  {
                    boxShadow: isDark
                      ? EDIT_PROFILE_SHADOWS_DARK
                      : EDIT_PROFILE_SHADOWS,
                    transform: [{ translateY: pressed ? 1 : 0 }],
                  },
                ]}
              >
                <LinearGradient
                  colors={
                    isDark ? ["#8f96a3", "#5c6370"] : ["#e4e7ec", "#c6ccd5"]
                  }
                  end={{ x: 0.5, y: 1 }}
                  start={{ x: 0.5, y: 0 }}
                  style={styles.editButtonGradient}
                >
                  <Pencil color={isDark ? "#ffffff" : "#1c1f26"} size={14} />
                  <Text
                    style={[
                      styles.editText,
                      { color: isDark ? "#ffffff" : "#1c1f26" },
                    ]}
                  >
                    Edit profile
                  </Text>
                </LinearGradient>
              </Pressable>
            ) : (
              <>
                <Pressable
                  accessibilityLabel={isFollowing ? "Unfollow" : "Follow"}
                  accessibilityRole="button"
                  disabled={!canFollow}
                  onPress={onFollow}
                  style={({ pressed }) => [
                    styles.followButton,
                    !canFollow && styles.disabled,
                    {
                      boxShadow: followStyles.shadow,
                      transform: [{ translateY: pressed ? 1 : 0 }],
                    },
                  ]}
                >
                  <LinearGradient
                    colors={followStyles.colors}
                    end={{ x: 0.5, y: 1 }}
                    start={{ x: 0.5, y: 0 }}
                    style={styles.followButtonGradient}
                  >
                    {isFollowing ? null : (
                      <UserPlus color="#ffffff" size={14} />
                    )}
                    <Text
                      style={[
                        styles.followText,
                        { color: followStyles.textColor },
                      ]}
                    >
                      {isFollowing ? "Following" : "Follow"}
                    </Text>
                  </LinearGradient>
                </Pressable>
                <Pressable
                  accessibilityLabel="Message"
                  accessibilityRole="button"
                  disabled={!canMessage}
                  onPress={onMessage}
                  style={({ pressed }) => [
                    styles.messageButton,
                    !canMessage && styles.disabled,
                    {
                      boxShadow: isDark
                        ? BTN_3D_GRAY_SHADOWS_DARK
                        : BTN_3D_GRAY_SHADOWS,
                      transform: [{ translateY: pressed ? 1 : 0 }],
                    },
                  ]}
                >
                  <LinearGradient
                    colors={
                      isDark ? ["#4a4a4a", "#333333"] : ["#f7f8fa", "#e4e7ec"]
                    }
                    end={{ x: 0.5, y: 1 }}
                    start={{ x: 0.5, y: 0 }}
                    style={styles.messageButtonGradient}
                  >
                    <MessageCircle
                      color={isDark ? "#ffffff" : "#1f2430"}
                      size={15}
                    />
                    <Text
                      style={[
                        styles.messageText,
                        { color: isDark ? "#ffffff" : "#1f2430" },
                      ]}
                    >
                      Message
                    </Text>
                  </LinearGradient>
                </Pressable>
              </>
            )}
          </View>
        </View>
        <View style={styles.identity}>
          <View style={styles.nameRow}>
            <Text style={[styles.name, { color: theme.inputText }]}>
              {profile.displayName || profile.username}
            </Text>
            <UserBadge
              badge={profile.badge}
              badges={profile.badges}
              communityRoles={profile.communityMemberships}
            />
          </View>
          <Text style={[styles.username, { color: theme.dividerText }]}>
            @{profile.username}
          </Text>
        </View>
        {profile.bio ? (
          <View style={styles.bio}>
            <BioContent
              apiBase={apiBase}
              bio={profile.bio}
              textSize={{ fontSize: 15, lineHeight: 22 }}
            />
          </View>
        ) : null}
        {joined ? (
          <View style={styles.metaRow}>
            <CalendarDays color={theme.dividerText} size={15} />
            <Text style={[styles.meta, { color: theme.dividerText }]}>
              Joined {joined}
            </Text>
          </View>
        ) : null}
        {role?.community?.slug ? (
          <Text style={[styles.role, { color: theme.dividerText }]}>
            Community role · a/{role.community.slug}
          </Text>
        ) : null}
        {socials.length > 0 ? (
          <View style={styles.socials}>
            {socials.map((social) => {
              const href = safeSocialUrl(social);
              return href ? (
                <Pressable
                  accessibilityLabel={social.label}
                  accessibilityRole="link"
                  key={social.href}
                  onPress={() => openSocial(href)}
                  style={({ pressed }) => [
                    styles.social,
                    {
                      backgroundColor: isDark ? "#232323" : theme.cardBg,
                      boxShadow: isDark
                        ? ICON_BUTTON_SHADOWS_DARK
                        : ICON_BUTTON_SHADOWS_LIGHT,
                      transform: [{ translateY: pressed ? 1 : 0 }],
                    },
                  ]}
                >
                  <SocialIcon color={theme.dividerText} kind={social.kind} />
                </Pressable>
              ) : null;
            })}
          </View>
        ) : null}
        <View style={styles.stats}>
          <InlineStat
            label="Following"
            onPress={() =>
              router.push({
                params: { username: profile.username },
                pathname: "/users/[username]/following",
              })
            }
            value={formatNumber(profile._count.following)}
          />
          <InlineStat
            label="Followers"
            onPress={() =>
              router.push({
                params: { username: profile.username },
                pathname: "/users/[username]/followers",
              })
            }
            value={formatNumber(profile._count.followers)}
          />
          <View style={styles.auraStat}>
            <Flame
              color={flame.color}
              fill={flame.filled ? flame.color : "none"}
              size={18}
            />
            <Text style={[styles.inlineValue, { color: theme.inputText }]}>
              {formatNumber(profile.aura)}
            </Text>
            <Text style={[styles.inlineLabel, { color: theme.dividerText }]}>
              Aura
            </Text>
          </View>
          <Pressable
            accessibilityLabel="Share profile"
            accessibilityRole="button"
            onPress={onShare}
            style={({ pressed }) => [
              styles.shareButton,
              {
                backgroundColor: isDark ? "#232323" : theme.cardBg,
                boxShadow: isDark
                  ? ICON_BUTTON_SHADOWS_DARK
                  : ICON_BUTTON_SHADOWS_LIGHT,
                transform: [{ translateY: pressed ? 1 : 0 }],
              },
            ]}
          >
            <Share2 color={theme.dividerText} size={16} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function InlineStat({
  label,
  onPress,
  value,
}: {
  label: string;
  onPress: () => void;
  value: string;
}) {
  const { theme } = useAppTheme();
  return (
    <Pressable
      accessibilityLabel={`View ${label.toLowerCase()}`}
      accessibilityRole="button"
      onPress={onPress}
      style={styles.inlineStat}
    >
      <Text style={[styles.inlineValue, { color: theme.inputText }]}>
        {value}
      </Text>
      <Text style={[styles.inlineLabel, { color: theme.dividerText }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  actions: {
    alignItems: "flex-end",
    flexDirection: "column",
    gap: 8,
    paddingBottom: 8,
  },
  auraStat: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
  },
  avatarOverlap: {
    borderRadius: 20,
    borderWidth: 4,
    overflow: "hidden",
  },
  avatarRow: {
    alignItems: "flex-end",
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: -56,
  },
  banner: { height: "100%", width: "100%" },
  bannerFade: {
    ...StyleSheet.absoluteFill,
  },
  bannerWrap: { overflow: "hidden" },
  bio: { marginTop: 12 },
  blurred: { opacity: 0.72, transform: [{ scale: 1.15 }] },
  content: { paddingHorizontal: 16 },
  disabled: { opacity: 0.45 },
  editButton: {
    borderRadius: 9999,
    height: 36,
    overflow: "hidden",
  },
  editButtonGradient: {
    alignItems: "center",
    borderRadius: 9999,
    flexDirection: "row",
    gap: 6,
    height: 36,
    paddingHorizontal: 16,
  },
  editText: { fontFamily: "SofiaProBold", fontSize: 14 },
  followButton: {
    borderRadius: 9999,
    height: 36,
    overflow: "hidden",
  },
  followButtonGradient: {
    alignItems: "center",
    borderRadius: 9999,
    flexDirection: "row",
    gap: 5,
    height: 36,
    paddingHorizontal: 16,
  },
  followText: { fontFamily: "SofiaProBold", fontSize: 14 },
  identity: { marginTop: 12 },
  inlineLabel: { fontFamily: "SofiaProMed", fontSize: 14 },
  inlineStat: {
    alignItems: "center",
    borderRadius: 6,
    flexDirection: "row",
    gap: 4,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  inlineValue: { fontFamily: "SofiaProBold", fontSize: 14 },
  messageButton: {
    borderRadius: 9999,
    height: 36,
    overflow: "hidden",
  },
  messageButtonGradient: {
    alignItems: "center",
    borderRadius: 9999,
    flexDirection: "row",
    gap: 5,
    height: 36,
    paddingHorizontal: 14,
  },
  messageText: { fontFamily: "SofiaProBold", fontSize: 14 },
  meta: { fontFamily: "SofiaProReg", fontSize: 14 },
  metaRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    marginTop: 12,
  },
  name: { fontFamily: "SofiaProBold", fontSize: 24, lineHeight: 29 },
  nameRow: { alignItems: "center", flexDirection: "row", gap: 6 },
  role: { fontFamily: "SofiaProReg", fontSize: 13, marginTop: 8 },
  root: { borderBottomColor: "rgba(128,128,128,0.25)", borderBottomWidth: 1 },
  shareButton: {
    alignItems: "center",
    borderRadius: 18,
    height: 36,
    justifyContent: "center",
    marginLeft: "auto",
    width: 36,
  },
  social: {
    alignItems: "center",
    borderRadius: 18,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  socials: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  stats: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    marginTop: 10,
    paddingBottom: 16,
  },
  username: { fontFamily: "SofiaProReg", fontSize: 14, marginTop: 2 },
});
