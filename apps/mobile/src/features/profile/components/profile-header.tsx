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

import avatarPlaceholder from "@/assets/images/avatar-placeholder.png";
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
import { useAppTheme } from "@/theme";

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
    <Image
      blurRadius={10}
      contentFit="cover"
      source={avatarPlaceholder}
      style={[styles.banner, styles.blurred]}
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
  const { theme } = useAppTheme();
  const router = useRouter();
  const apiBase = getApiBaseUrl();
  const banner = resolveProfileImageUrl(profile.bannerUrl, apiBase);
  const avatar = resolveProfileImageUrl(profile.avatarUrl, apiBase);
  const socials = getSocialLinks(profile);
  const flame = getAuraFlameStyle(profile.aura);
  const joined = formatJoinedDate(profile.createdAt);
  const role = profile.communityMemberships?.[0];
  const openSocial = useCallback(async (href: string) => {
    try {
      await Linking.openURL(href);
    } catch {
      // Linking can reject when the OS has no handler for the profile's host.
    }
  }, []);

  return (
    <View style={styles.root}>
      <View style={styles.bannerWrap}>
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
          <View style={styles.avatarOverlap}>
            <UserAvatar radius={12} size={112} url={profile.avatarUrl} />
          </View>
          <View style={styles.actions}>
            {isOwnProfile ? (
              <Pressable
                accessibilityLabel="Edit profile"
                accessibilityRole="button"
                onPress={onEdit}
                style={styles.editButton}
              >
                <Pencil color={theme.inputText} size={15} />
                <Text style={[styles.editText, { color: theme.inputText }]}>
                  Edit
                </Text>
              </Pressable>
            ) : (
              <>
                <Pressable
                  accessibilityLabel={isFollowing ? "Unfollow" : "Follow"}
                  accessibilityRole="button"
                  disabled={!canFollow}
                  onPress={onFollow}
                  style={[styles.followButton, !canFollow && styles.disabled]}
                >
                  <UserPlus color="#fff" size={15} />
                  <Text style={styles.followText}>
                    {isFollowing ? "Following" : "Follow"}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityLabel="Message"
                  accessibilityRole="button"
                  disabled={!canMessage}
                  onPress={onMessage}
                  style={[styles.messageButton, !canMessage && styles.disabled]}
                >
                  <MessageCircle color={theme.inputText} size={15} />
                  <Text
                    style={[styles.messageText, { color: theme.inputText }]}
                  >
                    Message
                  </Text>
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
                  style={styles.social}
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
            style={styles.shareButton}
          >
            <Share2 color={theme.dividerText} size={17} />
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
  avatarOverlap: { borderColor: "#171717", borderRadius: 16, borderWidth: 4 },
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
  bannerWrap: { height: 128, overflow: "hidden" },
  bio: { marginTop: 12 },
  blurred: { opacity: 0.72, transform: [{ scale: 1.15 }] },
  content: { paddingHorizontal: 16 },
  disabled: { opacity: 0.45 },
  editButton: {
    alignItems: "center",
    backgroundColor: "rgba(128,128,128,0.2)",
    borderRadius: 18,
    flexDirection: "row",
    gap: 6,
    height: 36,
    paddingHorizontal: 14,
  },
  editText: { fontFamily: "SofiaProMed", fontSize: 14 },
  followButton: {
    alignItems: "center",
    backgroundColor: "#f97316",
    borderRadius: 18,
    flexDirection: "row",
    gap: 5,
    height: 36,
    paddingHorizontal: 16,
  },
  followText: { color: "#fff", fontFamily: "SofiaProMed", fontSize: 14 },
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
    alignItems: "center",
    backgroundColor: "rgba(128,128,128,0.2)",
    borderRadius: 18,
    flexDirection: "row",
    gap: 5,
    height: 36,
    paddingHorizontal: 14,
  },
  messageText: { fontFamily: "SofiaProMed", fontSize: 14 },
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
    borderColor: "rgba(128,128,128,0.35)",
    borderRadius: 18,
    borderWidth: 1,
    height: 36,
    justifyContent: "center",
    marginLeft: "auto",
    width: 36,
  },
  social: {
    alignItems: "center",
    borderColor: "rgba(128,128,128,0.25)",
    borderRadius: 18,
    borderWidth: 1,
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
