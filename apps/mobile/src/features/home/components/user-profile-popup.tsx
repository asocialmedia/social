// 1:1 native port of web UserProfilePopover in compact mode
// (components/home/sidebars/left/user-profile-popover.tsx), which is what the
// web mobile top bar renders. Same sections in the same order: banner,
// avatar + joined date, name + badge + handle, bio, socials, the 4-stat
// panel, the actions row, and the bookmarks row.
//
// Presentation is the one deliberate difference: the web anchors a popover
// under the avatar; on native the card floats top-left under the header
// inside a transparent modal (outside taps and Android back dismiss it).
//
// Profile and bookmark totals load when the popup opens, through the API base
// (getApiBaseUrl: dev server in dev, prod in release) with the stored session
// cookie (authClient.getCookie), mirroring web's /api/users/[id] query.
// Responses ride the popup cache (profile-cache.ts, web's 5-minute
// staleTime), so reopening is instant and background refreshes keep it fresh.
import { FontAwesome6 } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import * as Linking from "expo-linking";
import {
  Bookmark,
  CalendarDays,
  FileText,
  Flame,
  Globe,
  LogOut,
  Settings2,
  UserPlus,
  Users,
} from "lucide-react-native";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  Dimensions,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import avatarPlaceholder from "@/assets/images/avatar-placeholder.png";
import { Spinner3D } from "@/components/feedback/spinner-3d";
import { useSessionContext } from "@/features/auth/state/session";
import { getApiBaseUrl } from "@/lib/api-env";
import { logWarn } from "@/lib/telemetry";
import {
  AVATAR_RING_SHADOWS,
  AVATAR_RING_SHADOWS_DARK,
  ERROR_SHADOWS,
  ICON_BUTTON_SHADOWS_DARK,
  ICON_BUTTON_SHADOWS_LIGHT,
  PROFILE_STATS_SHADOWS,
  PROFILE_STATS_SHADOWS_DARK,
  SURFACE_SHADOWS,
  SURFACE_SHADOWS_DARK,
  useAppTheme,
} from "@/theme";

import { BioContent } from "./bio-content";
import { LogoutDialog } from "./logout-dialog";
import { popupCache } from "./profile-cache";
import type { SocialLinkKind } from "./profile-utils";
import {
  formatJoinedDate,
  formatNumber,
  getAuraFlameStyle,
  getSocialLinks,
  resolveProfileImageUrl,
  safeSocialUrl,
} from "./profile-utils";
import { usePopupProfile } from "./use-popup-profile";
import type { PopupDataState } from "./use-popup-profile";
import { BadgePanel, UserBadge } from "./user-badge";

// Web popover width (w-[21rem]), capped to the handset.
const CARD_WIDTH = Math.min(336, Dimensions.get("window").width - 24);

type BrandIconName = "github" | "linkedin" | "reddit" | "x-twitter";

const BRAND_ICONS: Record<Exclude<SocialLinkKind, "website">, BrandIconName> = {
  github: "github",
  linkedin: "linkedin",
  reddit: "reddit",
  twitter: "x-twitter",
};

function BannerContent({
  avatarUri,
  bannerUri,
}: {
  avatarUri: string | null;
  bannerUri: string | null;
}) {
  if (bannerUri) {
    return (
      <Image
        contentFit="cover"
        source={{ uri: bannerUri }}
        style={styles.bannerImage}
      />
    );
  }
  if (avatarUri) {
    // Blurred avatar backdrop, like web's scale-110 blur-md layer.
    return (
      <Image
        blurRadius={20}
        contentFit="cover"
        source={{ uri: avatarUri }}
        style={[styles.bannerImage, styles.bannerBlurred]}
      />
    );
  }
  return (
    <LinearGradient
      colors={["#ff9500", "#e65500", "#8b2f00"]}
      end={{ x: 1, y: 1 }}
      start={{ x: 0, y: 0 }}
      style={[styles.bannerImage, styles.bannerGradient]}
    />
  );
}

function SocialIcon({ color, kind }: { color: string; kind: SocialLinkKind }) {
  if (kind === "website") {
    return <Globe color={color} size={16} />;
  }
  return <FontAwesome6 color={color} name={BRAND_ICONS[kind]} size={15} />;
}

interface PopupStatProps {
  icon: ReactNode;
  label: string;
  value: string;
}

function PopupStat({ icon, label, value }: PopupStatProps) {
  const { theme } = useAppTheme();
  return (
    <View style={styles.stat}>
      {icon}
      <Text style={[styles.statValue, { color: theme.inputText }]}>
        {value}
      </Text>
      <Text style={[styles.statLabel, { color: theme.dividerText }]}>
        {label}
      </Text>
    </View>
  );
}

interface UserProfilePopupProps {
  onClose: () => void;
  userId: string | null;
}

export function UserProfilePopup({ onClose, userId }: UserProfilePopupProps) {
  const { isDark, theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { signOut } = useSessionContext();
  const { reload, state }: { reload: () => void; state: PopupDataState } =
    usePopupProfile(userId);
  const [badgesOpen, setBadgesOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);

  useEffect(() => {
    // A new account must never inherit the previous one's open panels.
    // oxlint-disable-next-line react/set-state-in-effect -- resetting UI state for a newly opened account, not derived data
    setBadgesOpen(false);
    // oxlint-disable-next-line react/set-state-in-effect -- same reset as above
    setLogoutOpen(false);
    // oxlint-disable-next-line react/set-state-in-effect -- a new profile retries its avatar instead of keeping the old failure
    setAvatarFailed(false);
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- userId is the reset trigger by design; reading it is unnecessary
  }, [userId]);
  // Same ghost-icon recipe as the header bell/search (web icon-btn-3d).
  const iconShadows = isDark
    ? ICON_BUTTON_SHADOWS_DARK
    : ICON_BUTTON_SHADOWS_LIGHT;

  const closeLogout = () => setLogoutOpen(false);
  const confirmLogout = () => {
    setLogoutOpen(false);
    onClose();
    // The next account must never see this one's cached popup.
    popupCache.clear();
    void signOut();
  };

  const openLogoutDialog = () => {
    // Keep the popup mounted: the confirm dialog renders inside it, so
    // closing first would unmount the dialog before it ever appears.
    setLogoutOpen(true);
  };

  const profile = state.status === "ready" ? state.profile : null;
  const bookmarkTotal = state.status === "ready" ? state.bookmarkTotal : null;
  const socialLinks = profile ? getSocialLinks(profile) : [];
  const flame = getAuraFlameStyle(profile?.aura ?? 0);
  const apiBase = getApiBaseUrl();
  const bannerUri = profile
    ? resolveProfileImageUrl(profile.bannerUrl, apiBase)
    : null;
  const avatarUri = profile
    ? resolveProfileImageUrl(profile.avatarUrl, apiBase)
    : null;
  const joined = profile ? formatJoinedDate(profile.createdAt) : "";

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      transparent
      visible={userId !== null}
    >
      {/* Transparent backdrop: outside taps dismiss, like the web popover. */}
      <Pressable onPress={onClose} style={styles.backdrop}>
        <Pressable
          onPress={() => {
            /* taps on the card must not bubble to the backdrop */
          }}
          style={[
            styles.card,
            {
              backgroundColor: theme.cardBg,
              borderColor: theme.cardBorder,
              boxShadow: isDark ? SURFACE_SHADOWS_DARK : SURFACE_SHADOWS,
              top: insets.top + 64,
            },
          ]}
        >
          {state.status === "loading" ? (
            <View style={styles.center}>
              <Spinner3D size={44} />
            </View>
          ) : null}
          {state.status === "error" ? (
            <View style={styles.center}>
              <View
                style={[
                  styles.errorBox,
                  {
                    backgroundColor: theme.errorBannerBg,
                    boxShadow: ERROR_SHADOWS,
                  },
                ]}
              >
                <Text
                  style={[styles.errorText, { color: theme.errorBannerText }]}
                >
                  {state.message}
                </Text>
              </View>
              <Pressable
                hitSlop={6}
                onPress={() => reload()}
                style={styles.retryRow}
              >
                <Text style={[styles.retryText, { color: theme.auxLink }]}>
                  Try again
                </Text>
              </Pressable>
            </View>
          ) : null}
          {profile ? (
            <>
              <View style={styles.banner}>
                <BannerContent avatarUri={avatarUri} bannerUri={bannerUri} />
                <LinearGradient
                  colors={["rgba(255, 149, 0, 0.45)", "transparent"]}
                  end={{ x: 0.5, y: 1 }}
                  start={{ x: 0.5, y: 0 }}
                  style={styles.bannerScrim}
                />
                <LinearGradient
                  colors={["transparent", theme.cardBg]}
                  end={{ x: 0.5, y: 1 }}
                  start={{ x: 0.5, y: 0 }}
                  style={styles.bannerScrim}
                />
                <View
                  style={[
                    styles.bannerRule,
                    { backgroundColor: theme.cardBorder },
                  ]}
                />
              </View>

              <View style={styles.identity}>
                <View style={styles.avatarRow}>
                  <View style={styles.avatarFrame}>
                    <Image
                      contentFit="cover"
                      onError={() => {
                        logWarn("profile.popup_avatar_failed", {});
                        setAvatarFailed(true);
                      }}
                      source={
                        avatarUri && !avatarFailed
                          ? { uri: avatarUri }
                          : avatarPlaceholder
                      }
                      style={[styles.avatar, { backgroundColor: theme.cardBg }]}
                    />
                    {/* 4px card ring (web ring-4) plus the avatar-ring bevel:
                        boxShadow is not part of expo-image's ImageStyle. */}
                    <View
                      pointerEvents="none"
                      style={[
                        styles.avatarRing,
                        {
                          borderColor: theme.cardBg,
                          boxShadow: isDark
                            ? AVATAR_RING_SHADOWS_DARK
                            : AVATAR_RING_SHADOWS,
                        },
                      ]}
                    />
                  </View>
                  {joined ? (
                    <View style={styles.joined}>
                      <CalendarDays color={theme.dividerText} size={14} />
                      <Text
                        style={[
                          styles.joinedText,
                          { color: theme.dividerText },
                        ]}
                      >
                        Joined {joined}
                      </Text>
                    </View>
                  ) : null}
                </View>

                <View style={styles.nameBlock}>
                  <View style={styles.nameRow}>
                    <Text
                      numberOfLines={1}
                      style={[styles.name, { color: theme.inputText }]}
                    >
                      {profile.displayName || profile.username}
                    </Text>
                    <UserBadge
                      badge={profile.badge}
                      badges={profile.badges}
                      communityRoles={profile.communityMemberships}
                      onToggle={() => setBadgesOpen((open) => !open)}
                      open={badgesOpen}
                    />
                  </View>
                  <Text style={[styles.handle, { color: theme.dividerText }]}>
                    @{profile.username}
                  </Text>
                  {/* Floating panel like web's hover card: absolutely
                      positioned over the content below, so the card must not
                      clip (overflow visible; only the banner clips itself). */}
                  {badgesOpen ? (
                    <View style={styles.badgePanel}>
                      <BadgePanel
                        apiBase={apiBase}
                        badge={profile.badge}
                        badges={profile.badges}
                        communityRoles={profile.communityMemberships}
                      />
                    </View>
                  ) : null}
                </View>

                {profile.bio ? (
                  <View style={styles.bioWrap}>
                    <BioContent apiBase={apiBase} bio={profile.bio} />
                  </View>
                ) : null}

                {socialLinks.length > 0 ? (
                  <View style={styles.socials}>
                    {socialLinks.map((link) => (
                      <Pressable
                        accessibilityLabel={link.label}
                        accessibilityRole="link"
                        hitSlop={4}
                        key={link.label}
                        onPress={() => {
                          const url = safeSocialUrl(link);
                          if (url) {
                            void Linking.openURL(url);
                          }
                        }}
                        style={styles.socialBtn}
                      >
                        <SocialIcon
                          color={theme.dividerText}
                          kind={link.kind}
                        />
                      </Pressable>
                    ))}
                  </View>
                ) : null}
              </View>

              <View
                style={[
                  styles.stats,
                  {
                    backgroundColor: theme.containerBg,
                    borderColor: theme.cardBorder,
                    boxShadow: isDark
                      ? PROFILE_STATS_SHADOWS_DARK
                      : PROFILE_STATS_SHADOWS,
                  },
                ]}
              >
                <PopupStat
                  icon={<FileText color={theme.dividerText} size={16} />}
                  label="Posts"
                  value={formatNumber(profile._count.posts)}
                />
                <PopupStat
                  icon={<Users color={theme.dividerText} size={16} />}
                  label="Followers"
                  value={formatNumber(profile._count.followers)}
                />
                <PopupStat
                  icon={<UserPlus color={theme.dividerText} size={16} />}
                  label="Following"
                  value={formatNumber(profile._count.following)}
                />
                <PopupStat
                  icon={
                    <Flame
                      color={flame.color}
                      fill={flame.filled ? flame.color : "none"}
                      size={16}
                    />
                  }
                  label="Aura"
                  value={formatNumber(profile.aura)}
                />
              </View>

              <View style={styles.actions}>
                {/* h-9 premium pill, same construction as the bookmarks row
                    below: the shared AuthPrimaryButton is h-11 and would sit
                    taller than its siblings. */}
                <View
                  accessibilityLabel="View profile (coming soon)"
                  style={[styles.actionBtn, styles.stub]}
                >
                  <LinearGradient
                    colors={["#ff9500", "#e65500"]}
                    end={{ x: 0.5, y: 1 }}
                    start={{ x: 0.5, y: 0 }}
                    style={styles.actionGradient}
                  >
                    <Text style={styles.actionText}>View Profile</Text>
                  </LinearGradient>
                </View>
                <View
                  accessibilityLabel="Open settings (coming soon)"
                  style={[
                    styles.iconBtn,
                    {
                      backgroundColor: theme.passkeyBg,
                      boxShadow: iconShadows,
                    },
                    styles.stub,
                  ]}
                >
                  <Settings2 color={theme.passkeyIcon} size={16} />
                </View>
                <Pressable
                  accessibilityLabel="Log out"
                  accessibilityRole="button"
                  hitSlop={6}
                  onPress={() => {
                    openLogoutDialog();
                  }}
                >
                  {({ pressed }) => (
                    <View
                      style={[
                        styles.iconBtn,
                        {
                          backgroundColor: theme.passkeyBg,
                          boxShadow: iconShadows,
                        },
                        pressed && styles.pressedShift,
                      ]}
                    >
                      <LogOut color={theme.passkeyIcon} size={16} />
                    </View>
                  )}
                </Pressable>
              </View>

              <View style={[styles.bookmarks, styles.stub]}>
                <View style={styles.bookmarksBtn}>
                  <LinearGradient
                    colors={["#ff9500", "#e65500"]}
                    end={{ x: 0.5, y: 1 }}
                    start={{ x: 0.5, y: 0 }}
                    style={styles.bookmarksGradient}
                  >
                    <Bookmark color="#ffffff" size={16} />
                    <Text style={styles.bookmarksText}>Bookmarks</Text>
                    {bookmarkTotal !== null && bookmarkTotal > 0 ? (
                      <View style={styles.countChip}>
                        <Text style={styles.countText}>
                          {formatNumber(bookmarkTotal)}
                        </Text>
                      </View>
                    ) : null}
                  </LinearGradient>
                </View>
              </View>
            </>
          ) : null}
        </Pressable>
      </Pressable>

      <LogoutDialog
        onClose={closeLogout}
        onLogout={confirmLogout}
        open={logoutOpen}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  actionBtn: {
    borderRadius: 9999,
    flex: 1,
  },
  actionGradient: {
    alignItems: "center",
    borderRadius: 9999,
    height: 36,
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  actionText: {
    color: "#ffffff",
    fontFamily: "SofiaProMed",
    fontSize: 14,
    fontWeight: "normal",
    letterSpacing: -0.3,
    textShadowColor: "rgba(0, 0, 0, 0.2)",
    textShadowOffset: { height: 1, width: 0 },
    textShadowRadius: 1,
  },
  actions: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    marginTop: 16,
    paddingHorizontal: 16,
  },
  avatar: {
    borderRadius: 16,
    height: 72,
    width: 72,
  },
  avatarFrame: {
    height: 72,
    width: 72,
  },
  avatarRing: {
    borderRadius: 16,
    borderWidth: 4,
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  avatarRow: {
    alignItems: "flex-end",
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: -40,
    zIndex: 1,
  },
  backdrop: {
    flex: 1,
  },
  badgePanel: {
    elevation: 8,
    left: 0,
    position: "absolute",
    top: 64,
    width: 256,
    zIndex: 10,
  },
  banner: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    height: 96,
    overflow: "hidden",
    position: "relative",
  },
  bannerBlurred: {
    opacity: 0.3,
  },
  bannerGradient: {
    opacity: 0.8,
  },
  bannerImage: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  bannerRule: {
    bottom: 0,
    height: 1,
    left: 0,
    opacity: 0.4,
    position: "absolute",
    right: 0,
  },
  bannerScrim: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  bioWrap: {
    marginTop: 10,
  },
  bookmarks: {
    marginTop: 12,
    paddingBottom: 16,
    paddingHorizontal: 16,
  },
  bookmarksBtn: {
    borderRadius: 9999,
  },
  bookmarksGradient: {
    alignItems: "center",
    borderRadius: 9999,
    flexDirection: "row",
    gap: 8,
    height: 36,
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  bookmarksText: {
    color: "#ffffff",
    fontFamily: "SofiaProMed",
    fontSize: 14,
    fontWeight: "normal",
    letterSpacing: -0.3,
    textShadowColor: "rgba(0, 0, 0, 0.2)",
    textShadowOffset: { height: 1, width: 0 },
    textShadowRadius: 1,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    left: 12,
    position: "absolute",
    width: CARD_WIDTH,
  },
  center: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 200,
    padding: 24,
  },
  countChip: {
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.15)",
    borderColor: "rgba(255, 255, 255, 0.4)",
    borderRadius: 9999,
    borderWidth: 1,
    justifyContent: "center",
    marginLeft: 8,
    minHeight: 20,
    minWidth: 20,
    paddingHorizontal: 4,
  },
  countText: {
    color: "#ffffff",
    fontFamily: "SofiaProMed",
    fontSize: 10,
    fontWeight: "normal",
  },
  errorBox: {
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  errorText: {
    fontFamily: "SofiaProMed",
    fontSize: 12,
    fontWeight: "normal",
    textAlign: "center",
  },
  handle: {
    fontFamily: "SofiaProReg",
    fontSize: 14,
    fontWeight: "normal",
  },
  iconBtn: {
    alignItems: "center",
    borderRadius: 9999,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  identity: {
    paddingHorizontal: 16,
  },
  joined: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    paddingBottom: 4,
  },
  joinedText: {
    fontFamily: "SofiaProReg",
    fontSize: 12,
    fontWeight: "normal",
  },
  name: {
    flexShrink: 1,
    fontFamily: "SofiaProBold",
    fontSize: 18,
    fontWeight: "normal",
    lineHeight: 22,
  },
  nameBlock: {
    marginTop: 10,
  },
  nameRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
  },
  pressedShift: {
    opacity: 0.88,
    transform: [{ translateY: 1 }],
  },
  retryRow: {
    alignItems: "center",
    marginTop: 12,
  },
  retryText: {
    fontFamily: "SofiaProMed",
    fontSize: 14,
    fontWeight: "normal",
  },
  socialBtn: {
    alignItems: "center",
    borderRadius: 9999,
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  socials: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 12,
  },
  stat: {
    alignItems: "center",
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  statLabel: {
    fontFamily: "SofiaProReg",
    fontSize: 10,
    fontWeight: "normal",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  statValue: {
    fontFamily: "SofiaProBold",
    fontSize: 14,
    fontWeight: "normal",
  },
  stats: {
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: 4,
    marginHorizontal: 16,
    marginTop: 16,
    paddingHorizontal: 8,
    paddingVertical: 10,
  },
  stub: {
    opacity: 0.45,
  },
});
